// Shows the engine's preview surfaces in app windows (macOS). A Node-API addon
// loaded by the main process; src/main/preview-mac.ts drives it.
//
// The engine draws each display into a global IOSurface. A presenter puts a
// Metal layer above a window's content and copies each finished frame of that
// surface into the layer. Core Animation scales the layer to its view, so a
// move to a screen with another backing scale, a resize or a fullscreen change
// needs no rebuild, and nothing but the picture is ever shown.
//
// The engine writes a surface under a write lock, and the seed changes when
// that lock is taken, before the pixels are written. Locks do not exclude other
// processes, so a frame is copied once its seed has stayed the same for a
// whole poll interval.
//
//   attach(name, contentViewHandle, onError)  one view per display name
//   setSurface(name, surfaceId)               after every new engine surface
//   setFrame(name, x, y, width, height)       content-relative points, top-left origin
//   setHidden(name, hidden)                   covered by floating UI
//   setCutouts(name, [x, y, w, h, ...])       content-relative points, top-left origin:
//                                             areas left see-through so popups drawn in
//                                             the web content show above the preview
//   setDimmed(name, dimmed)                   a dialog is open above it
//   detach(name)
//   stats(name)                               { frames, width, height, x, y, viewWidth, viewHeight, hidden }
// Every call must come from the main thread (main-process JS runs there).
// onError(code) is called once when a presenter stops showing frames, and again
// only after it has shown a frame since.

#define NAPI_VERSION 8
#import <AppKit/AppKit.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>
#include <os/lock.h>
#include <time.h>

static const uint64_t kActivePollNs = 4 * NSEC_PER_MSEC;
static const uint64_t kIdlePollNs = 250 * NSEC_PER_MSEC;
/** A surface whose seed changes on every poll is still shown at least this often. */
static const uint64_t kMaxWaitNs = 50 * NSEC_PER_MSEC;

@interface SeenalyzePreviewView : NSView
@end

@implementation SeenalyzePreviewView
// Clicks and drags reach the web content (and the editor window) underneath.
- (NSView *)hitTest:(NSPoint)point {
  (void)point;
  return nil;
}
@end

@interface SeenalyzePresenter : NSObject
- (instancetype)initWithContentView:(NSView *)content
                             device:(id<MTLDevice>)device
                           commands:(id<MTLCommandQueue>)commands
                             report:(napi_threadsafe_function)report;
/** Returns an error code, or nil once the surface is shown. */
- (NSString *)setSurface:(IOSurfaceID)surfaceId;
- (void)setFrame:(NSRect)topLeftFrame;
- (void)setHidden:(BOOL)hidden;
- (void)setCutouts:(NSArray<NSValue *> *)cutouts;
- (void)setDimmed:(BOOL)dimmed;
/** `releaseReport` is false while the Node environment is being torn down (it frees the callback itself). */
- (void)closeReleasingReport:(BOOL)releaseReport;
/** Frames shown so far, the drawable size and the view's frame (content-relative, top-left origin). */
- (NSDictionary<NSString *, NSNumber *> *)stats;
@end

@implementation SeenalyzePresenter {
  // Main thread.
  NSView *_content;
  SeenalyzePreviewView *_view;
  id _occlusionObserver;
  BOOL _hasSurface;
  NSArray<NSValue *> *_cutouts;
  // Set once; used from the render queue.
  CAMetalLayer *_layer;
  /** The view's own layer; holds the Metal layer so popups can be masked out (AppKit ignores a mask on the view's root layer). */
  CALayer *_host;
  id<MTLCommandQueue> _commands;
  dispatch_queue_t _queue;
  dispatch_source_t _timer;
  napi_threadsafe_function _report;
  // Render queue.
  uint64_t _shownGeneration;
  uint32_t _shownSeed;
  uint32_t _observedSeed;
  uint64_t _waitingSince;
  BOOL _failed;
  // Shared; guarded by _lock.
  os_unfair_lock _lock;
  uint64_t _frames;
  id<MTLTexture> _source;
  uint64_t _generation;
  BOOL _hidden;
  BOOL _visible;
  BOOL _closed;
}

- (instancetype)initWithContentView:(NSView *)content
                             device:(id<MTLDevice>)device
                           commands:(id<MTLCommandQueue>)commands
                             report:(napi_threadsafe_function)report {
  if (!(self = [super init])) return nil;
  _lock = OS_UNFAIR_LOCK_INIT;
  _content = content;
  _commands = commands;
  _report = report;

  _layer = [CAMetalLayer layer];
  _layer.device = device;
  _layer.pixelFormat = MTLPixelFormatBGRA8Unorm;
  _layer.framebufferOnly = NO;  // drawables are blit targets
  _layer.opaque = YES;
  _layer.contentsGravity = kCAGravityResize;  // the engine letterboxes the canvas inside the surface
  _layer.backgroundColor = CGColorGetConstantColor(kCGColorBlack);
  CGColorSpaceRef srgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  _layer.colorspace = srgb;
  CGColorSpaceRelease(srgb);
  _layer.drawableSize = CGSizeMake(1, 1);
  NSNull *none = [NSNull null];
  _layer.actions = @{@"bounds" : none, @"position" : none, @"frame" : none, @"contents" : none, @"hidden" : none};

  _view = [[SeenalyzePreviewView alloc] initWithFrame:NSZeroRect];
  _host = [CALayer layer];
  _host.actions = _layer.actions;
  _host.backgroundColor = CGColorGetConstantColor(kCGColorClear);
  _layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
  [_host addSublayer:_layer];
  _view.layer = _host;  // layer-hosting: AppKit never redraws or replaces the layer's contents
  _view.wantsLayer = YES;
  // The web content is laid out from the top; keep the distance to the top
  // while the window resizes, until the next setFrame.
  _view.autoresizingMask = content.isFlipped ? NSViewMaxYMargin : NSViewMinYMargin;
  _view.hidden = YES;
  [content addSubview:_view positioned:NSWindowAbove relativeTo:nil];

  // Nothing is copied while the window is fully covered, minimized or on another Space.
  NSWindow *window = content.window;
  _visible = !window || (window.occlusionState & NSWindowOcclusionStateVisible) != 0;
  if (window) {
    __weak SeenalyzePresenter *weakSelf = self;
    _occlusionObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidChangeOcclusionStateNotification
                                                                         object:window
                                                                          queue:NSOperationQueue.mainQueue
                                                                     usingBlock:^(NSNotification *note) {
                                                                       NSWindow *changed = note.object;
                                                                       [weakSelf setVisible:(changed.occlusionState & NSWindowOcclusionStateVisible) != 0];
                                                                     }];
  }

  _queue = dispatch_queue_create("ai.seenalyze.preview", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0));
  _timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _queue);
  __weak SeenalyzePresenter *weakSelf = self;
  dispatch_source_set_event_handler(_timer, ^{
    @autoreleasepool {
      [weakSelf tick];
    }
  });
  [self updatePolling];
  dispatch_resume(_timer);
  return self;
}

- (NSString *)setSurface:(IOSurfaceID)surfaceId {
  IOSurfaceRef surface = IOSurfaceLookup(surfaceId);
  if (!surface) return @"preview-surface-missing";
  size_t width = IOSurfaceGetWidth(surface);
  size_t height = IOSurfaceGetHeight(surface);
  id<MTLTexture> texture = nil;
  if (width > 0 && height > 0) {
    MTLTextureDescriptor *descriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                          width:width
                                                                                         height:height
                                                                                      mipmapped:NO];
    descriptor.usage = MTLTextureUsageShaderRead;
    // Surface-backed textures must be shared (Apple silicon) or managed (Intel).
    descriptor.storageMode = _layer.device.hasUnifiedMemory ? MTLStorageModeShared : MTLStorageModeManaged;
    texture = [_layer.device newTextureWithDescriptor:descriptor iosurface:surface plane:0];
  }
  CFRelease(surface);  // the texture holds its own reference
  if (!texture) return @"preview-surface-unsupported";
  os_unfair_lock_lock(&_lock);
  _source = texture;
  _generation += 1;
  os_unfair_lock_unlock(&_lock);
  // Until the new surface's first frame is in, the layer keeps showing the last one.
  _hasSurface = YES;
  [self applyVisibility];
  return nil;
}

- (void)setFrame:(NSRect)frame {
  if (!_content.isFlipped) frame.origin.y = NSHeight(_content.bounds) - NSMaxY(frame);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _view.frame = frame;
  _layer.frame = _host.bounds;
  [self applyMask];
  [CATransaction commit];
}

- (void)setCutouts:(NSArray<NSValue *> *)cutouts {
  _cutouts = cutouts.count ? cutouts : nil;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [self applyMask];
  [CATransaction commit];
}

/** Dims the picture like the backdrop behind an open dialog. */
- (void)setDimmed:(BOOL)dimmed {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _host.opacity = dimmed ? 0.4f : 1.0f;
  [CATransaction commit];
}

/** Masks the cutouts (content-relative, top-left origin) out of the layer; the preview keeps running around them. */
- (void)applyMask {
  if (!_view) return;
  // An opaque layer may skip blending; it must blend while parts are cut out.
  _layer.opaque = _cutouts == nil;
  if (!_cutouts) {
    _layer.mask = nil;
    return;
  }
  NSRect bounds = _view.bounds;
  // The view's top-left corner in content coordinates (top-left origin), as setFrame received it.
  NSRect frame = _view.frame;
  CGFloat viewTop = _content.isFlipped ? NSMinY(frame) : NSHeight(_content.bounds) - NSMaxY(frame);
  CGMutablePathRef path = CGPathCreateMutable();
  CGPathAddRect(path, nullptr, bounds);
  // Overlapping cutouts are merged first: with even-odd filling, two that overlap would cancel out.
  NSMutableArray<NSValue *> *merged = [_cutouts mutableCopy];
  for (BOOL changed = YES; changed;) {
    changed = NO;
    for (NSUInteger a = 0; a < merged.count && !changed; a++) {
      for (NSUInteger b = a + 1; b < merged.count; b++) {
        if (!NSIntersectsRect(merged[a].rectValue, merged[b].rectValue)) continue;
        merged[a] = [NSValue valueWithRect:NSUnionRect(merged[a].rectValue, merged[b].rectValue)];
        [merged removeObjectAtIndex:b];
        changed = YES;
        break;
      }
    }
  }
  for (NSValue *value in merged) {
    NSRect cut = value.rectValue;
    // The layer's origin is bottom-left.
    NSRect local = NSMakeRect(cut.origin.x - NSMinX(frame), NSHeight(bounds) - (cut.origin.y - viewTop) - cut.size.height, cut.size.width, cut.size.height);
    NSRect clipped = NSIntersectionRect(local, bounds);
    if (!NSIsEmptyRect(clipped)) CGPathAddRect(path, nullptr, clipped);
  }
  CAShapeLayer *mask = [CAShapeLayer layer];
  mask.actions = @{@"path" : [NSNull null], @"bounds" : [NSNull null], @"position" : [NSNull null]};
  mask.frame = bounds;
  mask.fillRule = kCAFillRuleEvenOdd;
  mask.fillColor = CGColorGetConstantColor(kCGColorBlack);
  mask.path = path;
  CGPathRelease(path);
  _layer.mask = mask;
}

- (void)setHidden:(BOOL)hidden {
  os_unfair_lock_lock(&_lock);
  _hidden = hidden;
  os_unfair_lock_unlock(&_lock);
  [self applyVisibility];
}

- (void)setVisible:(BOOL)visible {
  os_unfair_lock_lock(&_lock);
  _visible = visible;
  os_unfair_lock_unlock(&_lock);
  [self updatePolling];
}

- (void)applyVisibility {
  os_unfair_lock_lock(&_lock);
  BOOL hidden = _hidden || _closed;
  os_unfair_lock_unlock(&_lock);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _view.hidden = hidden || !_hasSurface;
  [CATransaction commit];
  [self updatePolling];
}

/** Polls often only while frames can be shown. */
- (void)updatePolling {
  os_unfair_lock_lock(&_lock);
  BOOL active = !_closed && !_hidden && _visible;
  os_unfair_lock_unlock(&_lock);
  uint64_t interval = active ? kActivePollNs : kIdlePollNs;
  dispatch_source_set_timer(_timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)interval), interval, interval / 4);
}

- (void)closeReleasingReport:(BOOL)releaseReport {
  os_unfair_lock_lock(&_lock);
  BOOL wasClosed = _closed;
  _closed = YES;
  _source = nil;
  os_unfair_lock_unlock(&_lock);
  if (wasClosed) return;
  if (_occlusionObserver) [NSNotificationCenter.defaultCenter removeObserver:_occlusionObserver];
  _occlusionObserver = nil;
  dispatch_source_cancel(_timer);
  [_view removeFromSuperview];
  _view = nil;
  _content = nil;
  if (!releaseReport) return;
  // Released on the render queue, after any report still queued there.
  napi_threadsafe_function report = _report;
  dispatch_async(_queue, ^{
    napi_release_threadsafe_function(report, napi_tsfn_release);
  });
}

- (NSDictionary<NSString *, NSNumber *> *)stats {
  os_unfair_lock_lock(&_lock);
  uint64_t frames = _frames;
  os_unfair_lock_unlock(&_lock);
  CGSize drawable = _layer.drawableSize;
  NSRect frame = _view.frame;
  if (!_content.isFlipped) frame.origin.y = NSHeight(_content.bounds) - NSMaxY(frame);
  return @{
    @"frames" : @(frames),
    @"width" : @(drawable.width),
    @"height" : @(drawable.height),
    @"x" : @(frame.origin.x),
    @"y" : @(frame.origin.y),
    @"viewWidth" : @(frame.size.width),
    @"viewHeight" : @(frame.size.height),
    @"hidden" : @(_view.hidden),
    @"cutouts" : @(_cutouts.count),
    @"masked" : @(_layer.mask != nil),
    @"opacity" : @(_host.opacity),
  };
}

// ----- render queue ---------------------------------------------------------

- (BOOL)active {
  os_unfair_lock_lock(&_lock);
  BOOL active = !_closed && !_hidden && _visible;
  os_unfair_lock_unlock(&_lock);
  return active;
}

- (void)tick {
  os_unfair_lock_lock(&_lock);
  id<MTLTexture> source = _source;
  uint64_t generation = _generation;
  BOOL active = !_closed && !_hidden && _visible;
  os_unfair_lock_unlock(&_lock);
  if (!active || !source) return;

  BOOL newSurface = generation != _shownGeneration;
  uint32_t seed = IOSurfaceGetSeed(source.iosurface);
  if (!newSurface && seed == _shownSeed) {
    _waitingSince = 0;
    return;
  }
  uint64_t now = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
  if (_waitingSince == 0) _waitingSince = now;
  if (seed != _observedSeed) {
    // Changed since the last poll: the engine may still be writing this frame.
    _observedSeed = seed;
    if (now - _waitingSince < kMaxWaitNs) return;
  }

  if (newSurface) {
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    _layer.drawableSize = CGSizeMake(source.width, source.height);
    [CATransaction commit];
  }
  id<CAMetalDrawable> drawable = [_layer nextDrawable];
  if (!drawable) {
    // No drawable for a second while the preview is on screen.
    if ([self active]) [self fail:"preview-stalled"];
    return;
  }
  id<MTLTexture> target = drawable.texture;
  // A drawable from before a size change; the next one fits.
  if (target.width != source.width || target.height != source.height) return;

  id<MTLCommandBuffer> buffer = [_commands commandBuffer];
  id<MTLBlitCommandEncoder> blit = [buffer blitCommandEncoder];
  [blit copyFromTexture:source toTexture:target];
  [blit endEncoding];
  [buffer presentDrawable:drawable];
  dispatch_queue_t queue = _queue;
  __weak SeenalyzePresenter *weakSelf = self;
  [buffer addCompletedHandler:^(id<MTLCommandBuffer> done) {
    BOOL presented = done.status == MTLCommandBufferStatusCompleted;
    if (!presented) NSLog(@"[preview] frame copy failed: %@", done.error.localizedDescription);
    dispatch_async(queue, ^{
      [weakSelf presented:presented];
    });
  }];
  [buffer commit];
  _shownSeed = seed;
  _shownGeneration = generation;
  _waitingSince = 0;
}

- (void)presented:(BOOL)presented {
  if (presented) {
    _failed = NO;
    os_unfair_lock_lock(&_lock);
    _frames += 1;
    os_unfair_lock_unlock(&_lock);
  } else {
    [self fail:"preview-present-failed"];
  }
}

- (void)fail:(const char *)code {
  if (_failed) return;
  _failed = YES;
  os_unfair_lock_lock(&_lock);
  BOOL closed = _closed;
  os_unfair_lock_unlock(&_lock);
  // `code` is a string literal; it stays valid until the main thread reads it.
  if (!closed) napi_call_threadsafe_function(_report, (void *)code, napi_tsfn_nonblocking);
}
@end

// ----- Node-API -------------------------------------------------------------

static NSMutableDictionary<NSString *, SeenalyzePresenter *> *presenters;
static id<MTLDevice> device;
static id<MTLCommandQueue> commands;

static napi_value Throw(napi_env env, const char *code) {
  napi_throw_error(env, code, code);
  return nullptr;
}

static napi_value Undefined(napi_env env) {
  napi_value value;
  napi_get_undefined(env, &value);
  return value;
}

/** Reads the call's arguments; false when fewer than `count` were passed. */
static bool Args(napi_env env, napi_callback_info info, napi_value *argv, size_t count) {
  size_t argc = count;
  return napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) == napi_ok && argc >= count;
}

static NSString *Name(napi_env env, napi_value value) {
  char buffer[128];
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, buffer, sizeof(buffer), &length) != napi_ok || length == 0 || length >= sizeof(buffer) - 1) return nil;
  return [NSString stringWithUTF8String:buffer];
}

static SeenalyzePresenter *Find(napi_env env, napi_value name) {
  NSString *key = Name(env, name);
  return key ? presenters[key] : nil;
}

static void CallOnError(napi_env env, napi_value callback, void *context, void *data) {
  (void)context;
  if (!env || !callback) return;  // the environment is shutting down
  napi_value code;
  napi_value result;
  napi_create_string_utf8(env, static_cast<const char *>(data), NAPI_AUTO_LENGTH, &code);
  napi_call_function(env, Undefined(env), callback, 1, &code, &result);
}

static napi_value Attach(napi_env env, napi_callback_info info) {
  napi_value argv[3];
  if (!Args(env, info, argv, 3)) return Throw(env, "invalid-request");
  if (!NSThread.isMainThread) return Throw(env, "preview-wrong-thread");
  NSString *name = Name(env, argv[0]);
  void *data = nullptr;
  size_t length = 0;
  napi_valuetype callbackType;
  if (!name || napi_get_buffer_info(env, argv[1], &data, &length) != napi_ok || length < sizeof(void *) ||
      napi_typeof(env, argv[2], &callbackType) != napi_ok || callbackType != napi_function) {
    return Throw(env, "invalid-request");
  }
  if (presenters[name]) return Throw(env, "preview-exists");
  NSView *content = (__bridge NSView *)(*static_cast<void **>(data));
  if (!content) return Throw(env, "invalid-request");
  if (!device) {
    device = MTLCreateSystemDefaultDevice();
    commands = [device newCommandQueue];
    if (!device || !commands) {
      device = nil;
      commands = nil;
      return Throw(env, "preview-no-gpu");
    }
  }
  napi_value resource;
  napi_create_string_utf8(env, "seenalyze-preview", NAPI_AUTO_LENGTH, &resource);
  napi_threadsafe_function report;
  if (napi_create_threadsafe_function(env, argv[2], nullptr, resource, 0, 1, nullptr, nullptr, nullptr, CallOnError, &report) != napi_ok) {
    return Throw(env, "preview-attach-failed");
  }
  // Reports must not keep the process alive.
  napi_unref_threadsafe_function(env, report);
  presenters[name] = [[SeenalyzePresenter alloc] initWithContentView:content device:device commands:commands report:report];
  return Undefined(env);
}

static napi_value SetSurface(napi_env env, napi_callback_info info) {
  napi_value argv[2];
  uint32_t surfaceId = 0;
  if (!Args(env, info, argv, 2) || napi_get_value_uint32(env, argv[1], &surfaceId) != napi_ok || surfaceId == 0) return Throw(env, "invalid-request");
  SeenalyzePresenter *presenter = Find(env, argv[0]);
  if (!presenter) return Throw(env, "preview-not-attached");
  NSString *error = [presenter setSurface:surfaceId];
  return error ? Throw(env, error.UTF8String) : Undefined(env);
}

static napi_value SetFrame(napi_env env, napi_callback_info info) {
  napi_value argv[5];
  double values[4];
  if (!Args(env, info, argv, 5)) return Throw(env, "invalid-request");
  for (int index = 0; index < 4; index++) {
    if (napi_get_value_double(env, argv[index + 1], &values[index]) != napi_ok || !isfinite(values[index])) return Throw(env, "invalid-request");
  }
  if (values[2] < 0 || values[3] < 0) return Throw(env, "invalid-request");
  SeenalyzePresenter *presenter = Find(env, argv[0]);
  if (!presenter) return Throw(env, "preview-not-attached");
  [presenter setFrame:NSMakeRect(values[0], values[1], values[2], values[3])];
  return Undefined(env);
}

static napi_value SetHidden(napi_env env, napi_callback_info info) {
  napi_value argv[2];
  bool hidden = false;
  if (!Args(env, info, argv, 2) || napi_get_value_bool(env, argv[1], &hidden) != napi_ok) return Throw(env, "invalid-request");
  SeenalyzePresenter *presenter = Find(env, argv[0]);
  if (!presenter) return Throw(env, "preview-not-attached");
  [presenter setHidden:hidden];
  return Undefined(env);
}

static napi_value SetDimmed(napi_env env, napi_callback_info info) {
  napi_value argv[2];
  bool dimmed = false;
  if (!Args(env, info, argv, 2) || napi_get_value_bool(env, argv[1], &dimmed) != napi_ok) return Throw(env, "invalid-request");
  SeenalyzePresenter *presenter = Find(env, argv[0]);
  if (!presenter) return Throw(env, "preview-not-attached");
  [presenter setDimmed:dimmed];
  return Undefined(env);
}

static napi_value SetCutouts(napi_env env, napi_callback_info info) {
  napi_value argv[2];
  bool isArray = false;
  uint32_t length = 0;
  if (!Args(env, info, argv, 2) || napi_is_array(env, argv[1], &isArray) != napi_ok || !isArray ||
      napi_get_array_length(env, argv[1], &length) != napi_ok || length % 4 != 0 || length > 4 * 64) {
    return Throw(env, "invalid-request");
  }
  NSMutableArray<NSValue *> *cutouts = [NSMutableArray arrayWithCapacity:length / 4];
  for (uint32_t index = 0; index < length; index += 4) {
    double values[4];
    for (uint32_t part = 0; part < 4; part++) {
      napi_value element;
      if (napi_get_element(env, argv[1], index + part, &element) != napi_ok || napi_get_value_double(env, element, &values[part]) != napi_ok ||
          !isfinite(values[part])) {
        return Throw(env, "invalid-request");
      }
    }
    if (values[2] <= 0 || values[3] <= 0) continue;
    [cutouts addObject:[NSValue valueWithRect:NSMakeRect(values[0], values[1], values[2], values[3])]];
  }
  SeenalyzePresenter *presenter = Find(env, argv[0]);
  if (!presenter) return Throw(env, "preview-not-attached");
  [presenter setCutouts:cutouts];
  return Undefined(env);
}

static napi_value Detach(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  if (!Args(env, info, argv, 1)) return Throw(env, "invalid-request");
  NSString *name = Name(env, argv[0]);
  if (!name) return Throw(env, "invalid-request");
  [presenters[name] closeReleasingReport:YES];
  [presenters removeObjectForKey:name];
  return Undefined(env);
}

static napi_value Stats(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  if (!Args(env, info, argv, 1)) return Throw(env, "invalid-request");
  SeenalyzePresenter *presenter = Find(env, argv[0]);
  if (!presenter) return Throw(env, "preview-not-attached");
  napi_value result;
  napi_create_object(env, &result);
  [[presenter stats] enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSNumber *number, BOOL *stop) {
    (void)stop;
    napi_value value;
    napi_create_double(env, number.doubleValue, &value);
    napi_set_named_property(env, result, key.UTF8String, value);
  }];
  return result;
}

static void Cleanup(void *arg) {
  (void)arg;
  for (SeenalyzePresenter *presenter in presenters.allValues) [presenter closeReleasingReport:NO];
  [presenters removeAllObjects];
}

NAPI_MODULE_INIT() {
  if (!presenters) presenters = [NSMutableDictionary dictionary];
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  napi_property_descriptor properties[] = {
      {"attach", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setSurface", nullptr, SetSurface, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setFrame", nullptr, SetFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setHidden", nullptr, SetHidden, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setDimmed", nullptr, SetDimmed, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setCutouts", nullptr, SetCutouts, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"detach", nullptr, Detach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stats", nullptr, Stats, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
