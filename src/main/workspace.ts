// Scene collections and profiles: create, rename, duplicate, remove and switch.
// Switching a collection (or the audio format) restarts the engine with the
// new data, which follows the engine teardown rules instead of releasing
// scenes and sources in a running engine. Every operation runs one at a time
// and is refused while anything is streaming, recording or on the virtual
// camera. The Studio provides the engine and persistence through the host.

import { randomUUID } from "node:crypto";
import { DEFAULT_RECORDING_TRACKS, sanitizeAudioFormat, sanitizeRecordingTracks, type AudioFormat } from "../shared/formats";
import type { TransitionChoice } from "../shared/transitions";
import type { AdvancedStreamSettings, DestinationConfig, DestinationProfile, Platform, StudioPreferences, VideoSettings } from "../shared/types";
import {
  cleanEntryName,
  entryNameTaken,
  MAX_ENTRIES,
  PROFILE_PREFERENCE_KEYS,
  type ImportResult,
  type NamedList,
  type ProfileData,
  type ProfilePreferences,
  uniqueEntryName,
} from "../shared/workspace";
import { rescaleCollection, type CanvasSize, type CollectionFiles, type WorkspaceFields } from "./collections";
import type { SceneCollection } from "./engine/scenes";
import type { ConvertedCollection } from "./obs-import";

/** The parts of the persisted studio state the workspace reads and changes. */
export interface WorkspaceState extends WorkspaceFields {
  collection: SceneCollection | null;
  transition: TransitionChoice;
  video: VideoSettings;
  encoder: string | null;
  recordingFolder: string | null;
  preferences: StudioPreferences;
  advanced: AdvancedStreamSettings;
  destinations: DestinationConfig[];
}

export interface WorkspaceHost {
  readonly state: WorkspaceState;
  files: CollectionFiles;
  /** Streaming, recording or virtual camera: switching would cut them off. */
  locked(): boolean;
  /** Saves the engine's collection into state.collection, then stops the engine. */
  stopEngine(): Promise<void>;
  /** Starts the engine from the state (collection, transition, video, audio format). */
  startEngine(): Promise<void>;
  /** Saves the engine's current collection into state.collection without stopping it. */
  captureCollection(): Promise<void>;
  /** Applies new video settings to the running engine (canvas, rescale, preview). */
  applyVideo(video: VideoSettings): Promise<void>;
  /** Writes studio.json immediately. */
  writeState(): void;
  /** Settings changed outside the usual setters: re-check the encoder, instant replay, snapshot. */
  settingsChanged(): Promise<void>;
  pushSnapshot(): void;
  sanitizeVideo(video: VideoSettings): VideoSettings;
  sanitizePreferences(preferences: StudioPreferences): StudioPreferences;
  sanitizeAdvanced(advanced: AdvancedStreamSettings): AdvancedStreamSettings;
  sanitizeProfile(platform: Platform, profile: DestinationProfile): DestinationProfile;
  defaults: { video: VideoSettings; preferences: StudioPreferences; advanced: AdvancedStreamSettings };
}

function canvasOf(video: VideoSettings): CanvasSize {
  return { width: video.baseWidth, height: video.baseHeight };
}

function pickPreferences(preferences: StudioPreferences): ProfilePreferences {
  return Object.fromEntries(PROFILE_PREFERENCE_KEYS.map((key) => [key, preferences[key]])) as ProfilePreferences;
}

function sameAudio(a: AudioFormat | null, b: AudioFormat | null): boolean {
  return a?.sampleRate === b?.sampleRate && a?.speakers === b?.speakers;
}

export class Workspace {
  private queue: Promise<unknown> = Promise.resolve();
  private running = 0;

  constructor(
    private readonly host: WorkspaceHost,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** True while a switch or restart is in progress. */
  get switching(): boolean {
    return this.running > 0;
  }

  // ----- collections ------------------------------------------------------------

  createCollection(name: unknown): Promise<void> {
    return this.exclusive(async () => {
      const state = this.host.state;
      const clean = this.newName(state.collections, name);
      this.requireUnlocked();
      const id = this.newId();
      await this.swapCollection(() => ({ id, collection: null, transition: undefined, list: { activeId: id, items: [...state.collections.items, { id, name: clean }] } }));
    });
  }

  renameCollection(id: string, name: unknown): Promise<void> {
    return this.exclusive(async () => {
      this.rename(this.host.state.collections, id, name, (list) => (this.host.state.collections = list));
    });
  }

  /** Copies a collection under a new name; the copy is not switched to. */
  duplicateCollection(id: string, name: unknown): Promise<void> {
    return this.exclusive(async () => {
      const state = this.host.state;
      this.requireEntry(state.collections, id);
      const clean = this.newName(state.collections, name);
      const copy = this.newId();
      if (id === state.collections.activeId) {
        await this.host.captureCollection();
        this.host.files.write(copy, { canvas: canvasOf(state.video), transition: state.transition, collection: state.collection });
      } else {
        this.host.files.copy(id, copy);
      }
      state.collections = { ...state.collections, items: [...state.collections.items, { id: copy, name: clean }] };
      this.save();
    });
  }

  removeCollection(id: string): Promise<void> {
    return this.exclusive(async () => {
      const state = this.host.state;
      this.requireEntry(state.collections, id);
      if (state.collections.items.length <= 1) throw new Error("last-collection");
      if (id === state.collections.activeId) {
        this.requireUnlocked();
        const next = state.collections.items.find((entry) => entry.id !== id)?.id as string;
        // The removed collection is not kept: switch without saving it to a file.
        await this.switchTo(next, false);
      }
      state.collections = { ...state.collections, items: state.collections.items.filter((entry) => entry.id !== id) };
      this.save();
      this.host.files.remove(id);
    });
  }

  switchCollection(id: string): Promise<void> {
    return this.exclusive(async () => {
      const state = this.host.state;
      this.requireEntry(state.collections, id);
      if (id === state.collections.activeId) return;
      this.requireUnlocked();
      await this.switchTo(id, true);
    });
  }

  /** Adds a converted collection from another app, and switches to it when nothing is live. */
  importCollection(converted: ConvertedCollection, switchTo: boolean): Promise<ImportResult> {
    return this.exclusive(async () => {
      const state = this.host.state;
      if (state.collections.items.length >= MAX_ENTRIES) throw new Error("too-many-entries");
      const name = uniqueImportName(state.collections, converted.name);
      const id = this.newId();
      this.host.files.write(id, { canvas: canvasOf(state.video), transition: converted.transition ?? undefined, collection: converted.collection });
      state.collections = { ...state.collections, items: [...state.collections.items, { id, name }] };
      this.save();
      const switched = switchTo && !this.host.locked();
      if (switched) await this.switchTo(id, true);
      return {
        collectionId: id,
        name,
        scenes: converted.stats.scenes,
        sources: converted.stats.sources,
        unavailableSources: converted.stats.unavailableSources,
        skippedFilters: converted.stats.skippedFilters,
        switched,
      };
    });
  }

  // ----- profiles -----------------------------------------------------------------

  /** A new profile starts from the default settings and becomes active. */
  createProfile(name: unknown): Promise<void> {
    return this.exclusive(async () => {
      const state = this.host.state;
      const clean = this.newName(state.profiles, name);
      this.requireUnlocked();
      const id = this.newId();
      state.profileData = { ...state.profileData, [id]: this.defaultProfile() };
      state.profiles = { ...state.profiles, items: [...state.profiles.items, { id, name: clean }] };
      await this.switchProfileTo(id);
    });
  }

  renameProfile(id: string, name: unknown): Promise<void> {
    return this.exclusive(async () => {
      this.rename(this.host.state.profiles, id, name, (list) => (this.host.state.profiles = list));
    });
  }

  duplicateProfile(id: string, name: unknown): Promise<void> {
    return this.exclusive(async () => {
      const state = this.host.state;
      this.requireEntry(state.profiles, id);
      const clean = this.newName(state.profiles, name);
      const copy = this.newId();
      const data = id === state.profiles.activeId ? this.captureProfile() : (state.profileData[id] ?? this.defaultProfile());
      state.profileData = { ...state.profileData, [copy]: structuredClone(data) };
      state.profiles = { ...state.profiles, items: [...state.profiles.items, { id: copy, name: clean }] };
      this.save();
    });
  }

  removeProfile(id: string): Promise<void> {
    return this.exclusive(async () => {
      const state = this.host.state;
      this.requireEntry(state.profiles, id);
      if (state.profiles.items.length <= 1) throw new Error("last-profile");
      if (id === state.profiles.activeId) {
        this.requireUnlocked();
        await this.switchProfileTo(state.profiles.items.find((entry) => entry.id !== id)?.id as string);
      }
      const rest = { ...state.profileData };
      delete rest[id];
      state.profileData = rest;
      state.profiles = { ...state.profiles, items: state.profiles.items.filter((entry) => entry.id !== id) };
      this.save();
    });
  }

  switchProfile(id: string): Promise<void> {
    return this.exclusive(async () => {
      const state = this.host.state;
      this.requireEntry(state.profiles, id);
      if (id === state.profiles.activeId) return;
      this.requireUnlocked();
      await this.switchProfileTo(id);
    });
  }

  // ----- formats ----------------------------------------------------------------------

  /** Audio format (restarts the engine when it changes) and recording tracks. */
  setFormats(patch: { audio?: unknown; recordingTracks?: unknown }): Promise<void> {
    return this.exclusive(async () => {
      const state = this.host.state;
      this.requireUnlocked();
      if (patch.recordingTracks !== undefined) state.recordingTracks = sanitizeRecordingTracks(patch.recordingTracks);
      if (patch.audio !== undefined) {
        const audio = patch.audio === null ? null : sanitizeAudioFormat(patch.audio);
        if (patch.audio !== null && !audio) throw new Error("invalid-request");
        if (!sameAudio(audio, state.audioFormat)) {
          await this.host.stopEngine();
          try {
            state.audioFormat = audio;
            this.save();
          } finally {
            await this.host.startEngine();
          }
          return;
        }
      }
      this.save();
    });
  }

  // ----- internals ------------------------------------------------------------------

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      this.running += 1;
      this.host.pushSnapshot();
      try {
        return await task();
      } finally {
        this.running -= 1;
        this.host.pushSnapshot();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private save(): void {
    this.host.writeState();
    this.host.pushSnapshot();
  }

  private requireUnlocked(): void {
    if (this.host.locked()) throw new Error("workspace-locked");
  }

  private requireEntry(list: NamedList, id: string): void {
    if (!list.items.some((entry) => entry.id === id)) throw new Error("workspace-entry-not-found");
  }

  private newName(list: NamedList, name: unknown): string {
    const clean = cleanEntryName(name);
    if (!clean) throw new Error("invalid-request");
    if (entryNameTaken(list.items, clean)) throw new Error("name-taken");
    if (list.items.length >= MAX_ENTRIES) throw new Error("too-many-entries");
    return clean;
  }

  private rename(list: NamedList, id: string, name: unknown, assign: (next: NamedList) => void): void {
    this.requireEntry(list, id);
    const clean = cleanEntryName(name);
    if (!clean) throw new Error("invalid-request");
    if (entryNameTaken(list.items, clean, id)) throw new Error("name-taken");
    assign({ ...list, items: list.items.map((entry) => (entry.id === id ? { ...entry, name: clean } : entry)) });
    this.save();
  }

  /** Switches to a stored collection; `keepCurrent` saves the outgoing one to its file first. */
  private async switchTo(id: string, keepCurrent: boolean): Promise<void> {
    // Read first: a damaged file must not cost the collection in use.
    const target = this.host.files.read(id);
    await this.swapCollection(() => {
      const canvas = canvasOf(this.host.state.video);
      return {
        id,
        collection: target.collection ? rescaleCollection(target.collection, target.canvas, canvas) : null,
        transition: target.transition,
        list: { ...this.host.state.collections, activeId: id },
        keepCurrent,
      };
    });
    this.host.files.remove(id);
  }

  /**
   * Stops the engine (which saves the current collection into the state),
   * stores the outgoing collection, puts the incoming one in the state and
   * starts the engine again. The engine always restarts, also on failure.
   */
  private async swapCollection(
    next: () => { id: string; collection: SceneCollection | null; transition: TransitionChoice | undefined; list: NamedList; keepCurrent?: boolean },
  ): Promise<void> {
    const state = this.host.state;
    await this.host.stopEngine();
    try {
      const incoming = next();
      if (incoming.keepCurrent !== false) {
        this.host.files.write(state.collections.activeId, { canvas: canvasOf(state.video), transition: state.transition, collection: state.collection });
      }
      state.collection = incoming.collection;
      if (incoming.transition) state.transition = incoming.transition;
      state.collections = incoming.list;
      // One atomic write holds the collection and which entry it belongs to.
      this.save();
    } finally {
      await this.host.startEngine();
    }
  }

  private captureProfile(): ProfileData {
    const state = this.host.state;
    return structuredClone({
      video: state.video,
      encoder: state.encoder,
      recordingFolder: state.recordingFolder,
      preferences: pickPreferences(state.preferences),
      advanced: state.advanced,
      audioFormat: state.audioFormat,
      recordingTracks: state.recordingTracks,
      destinationProfiles: Object.fromEntries(state.destinations.map((destination) => [destination.id, destination.profile])),
    });
  }

  private defaultProfile(): ProfileData {
    const { defaults, state } = this.host;
    return structuredClone({
      video: defaults.video,
      encoder: state.encoder,
      recordingFolder: state.recordingFolder,
      preferences: pickPreferences(defaults.preferences),
      advanced: defaults.advanced,
      audioFormat: null,
      recordingTracks: DEFAULT_RECORDING_TRACKS,
      destinationProfiles: {},
    });
  }

  /** Stores the active profile's settings and applies the target's. */
  private async switchProfileTo(id: string): Promise<void> {
    const state = this.host.state;
    const target = state.profileData[id] ?? this.defaultProfile();
    const outgoing = state.profiles.activeId;
    const rest = { ...state.profileData, [outgoing]: this.captureProfile() };
    delete rest[id];
    state.profileData = rest;
    state.profiles = { ...state.profiles, activeId: id };
    await this.applyProfile(target);
    this.save();
    await this.host.settingsChanged();
  }

  private async applyProfile(data: ProfileData): Promise<void> {
    const { host } = this;
    const state = host.state;
    const video = host.sanitizeVideo(data.video ?? host.defaults.video);
    const audio = data.audioFormat === null || data.audioFormat === undefined ? null : sanitizeAudioFormat(data.audioFormat);
    state.encoder = typeof data.encoder === "string" ? data.encoder : state.encoder;
    state.recordingFolder = typeof data.recordingFolder === "string" ? data.recordingFolder : null;
    state.preferences = host.sanitizePreferences({ ...state.preferences, ...pickPreferences({ ...state.preferences, ...data.preferences }) });
    state.advanced = host.sanitizeAdvanced({ ...host.defaults.advanced, ...data.advanced });
    state.recordingTracks = sanitizeRecordingTracks(data.recordingTracks);
    for (const destination of state.destinations) {
      const profile = data.destinationProfiles?.[destination.id];
      if (profile) destination.profile = host.sanitizeProfile(destination.platform, { ...profile, fps: video.fps });
      else destination.profile = { ...destination.profile, fps: video.fps };
    }
    if (!sameAudio(audio, state.audioFormat)) {
      // The audio format only applies at engine start; the canvas change goes with it.
      await host.stopEngine();
      try {
        if (state.collection) state.collection = rescaleCollection(state.collection, canvasOf(state.video), canvasOf(video));
        state.video = video;
        state.audioFormat = audio;
        this.save();
      } finally {
        await host.startEngine();
      }
      return;
    }
    if (JSON.stringify(video) !== JSON.stringify(state.video)) await host.applyVideo(video);
  }
}

function uniqueImportName(list: NamedList, name: string): string {
  return uniqueEntryName(list.items, cleanEntryName(name) ?? "");
}
