// Development only (never shipped): starts Electron for `bun run dev` as its
// own app for macOS privacy access.
//
// macOS grants camera, microphone and screen access to the "responsible" app,
// which a process inherits from whatever started it. Started from a terminal
// or an editor, the dev app is judged by that tool's permissions: a hardened
// tool without the camera entitlement makes macOS refuse the camera without a
// prompt, and the dev app never appears in System Settings. Spawning Electron
// with responsibility disclaimed makes Electron.app (which has the usage
// descriptions) responsible for itself and everything it starts, like the
// packaged app opened from Finder.
//
// Usage: SEENALYZE_DEV_ELECTRON=<Electron executable> dev-launcher [args...]
// Signals are forwarded to Electron, and the launcher exits with its status.

#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

// libSystem private API (macOS 10.14+), also used by Chromium and LLDB.
int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs, int disclaim);

static volatile pid_t child = 0;
// A signal that arrives before Electron exists is delivered once it starts.
static volatile sig_atomic_t pending = 0;

static void forward(int signal_number) {
  if (child > 0) kill(child, signal_number);
  else pending = signal_number;
}

int main(int argc, char **argv) {
  (void)argc;
  const char *electron = getenv("SEENALYZE_DEV_ELECTRON");
  if (!electron || !*electron) {
    fprintf(stderr, "[dev-launcher] SEENALYZE_DEV_ELECTRON is not set; start the app with `bun run dev`\n");
    return 1;
  }

  posix_spawnattr_t attrs;
  int error = posix_spawnattr_init(&attrs);
  if (error) {
    fprintf(stderr, "[dev-launcher] posix_spawnattr_init failed: %s\n", strerror(error));
    return 1;
  }
  error = responsibility_spawnattrs_setdisclaim(&attrs, 1);
  if (error) {
    fprintf(stderr, "[dev-launcher] could not make Electron responsible for itself: %s\n", strerror(error));
    posix_spawnattr_destroy(&attrs);
    return 1;
  }

  const int forwarded[] = {SIGTERM, SIGINT, SIGHUP, SIGQUIT};
  for (size_t index = 0; index < sizeof forwarded / sizeof forwarded[0]; index++) {
    struct sigaction action;
    memset(&action, 0, sizeof action);
    action.sa_handler = forward;
    sigemptyset(&action.sa_mask);
    if (sigaction(forwarded[index], &action, NULL) != 0) {
      fprintf(stderr, "[dev-launcher] sigaction failed: %s\n", strerror(errno));
      posix_spawnattr_destroy(&attrs);
      return 1;
    }
  }

  argv[0] = (char *)electron;
  pid_t pid = 0;
  error = posix_spawn(&pid, electron, NULL, &attrs, argv, environ);
  posix_spawnattr_destroy(&attrs);
  if (error) {
    fprintf(stderr, "[dev-launcher] could not start %s: %s\n", electron, strerror(error));
    return 1;
  }
  child = pid;
  if (pending) kill(pid, pending);

  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno == EINTR) continue;
    fprintf(stderr, "[dev-launcher] waitpid failed: %s\n", strerror(errno));
    return 1;
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}
