type UpdateState = {
  available: boolean;
  offlineReady: boolean;
  applying: boolean;
  error: boolean;
};

// Keep this store outside React: registration callbacks can arrive before mount.
export class ScannerUpdates {
  private state: UpdateState = {
    available: false,
    offlineReady: false,
    applying: false,
    error: false,
  };
  private listeners = new Set<() => void>();
  private reloadReady = false;
  private reloading = false;
  private activate: (() => Promise<void>) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(private readonly reload: () => void) {}

  public getSnapshot = (): UpdateState => this.state;
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public connect(activate: () => Promise<void>): void {
    this.activate = activate;
  }

  public onNeedRefresh = (): void => {
    this.set({ available: true, error: false });
  };
  public onOfflineReady = (): void => {
    this.set({ offlineReady: true });
  };
  public onRegisterError = (): void => {
    this.set({ error: true });
  };
  public onNeedReload = (): void => {
    this.reloadReady = true;
    // Another tab may activate the worker while this tab is recording a scan.
    // Reload only after this tab's operator explicitly requested it.
    if (this.state.applying) {
      clearTimeout(this.timer);
      this.reloadOnce();
    } else {
      this.set({ available: true });
    }
  };

  public apply = async (): Promise<void> => {
    if (!this.state.available || this.state.applying || !this.activate) return;
    this.set({ applying: true, error: false });
    if (this.reloadReady) {
      this.reloadOnce();
      return;
    }
    this.timer = setTimeout(() => this.failed(), 30_000);
    try {
      await this.activate();
    } catch {
      this.failed();
    }
  };

  private failed(): void {
    clearTimeout(this.timer);
    this.set({ applying: false, error: true });
  }

  private reloadOnce(): void {
    if (this.reloading) return;
    this.reloading = true;
    this.reload();
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export const scannerUpdates = new ScannerUpdates(() =>
  window.location.reload(),
);
