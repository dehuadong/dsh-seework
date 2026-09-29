/**
 * A minimal observable snapshot store.
 *
 * The shell's `dsh-client-store` package is not in the shared module baseline,
 * so depending on it would either duplicate the store machinery inside this
 * bundle or drag in its zustand/immer tree. The settings bridge needs only
 * "read the current value, subscribe, replace or patch it", which is this file.
 */

/** One observable value with React-friendly snapshot semantics. */
export class SnapshotStore<T> {
  private value: T
  private readonly listeners = new Set<() => void>()

  constructor(initial: T) {
    this.value = initial
  }

  /** @returns the current value; the reference changes on every update. */
  getSnapshot(): T {
    return this.value
  }

  /** @returns the disposer removing this listener. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Replace the value and notify listeners. */
  set(next: T): void {
    this.value = next
    this.notify()
  }

  /** Patch the value with a mutator that receives a detached copy. */
  update(mutator: (draft: T) => void): void {
    const draft = { ...(this.value as unknown as Record<string, unknown>) } as unknown as T
    mutator(draft)
    this.value = draft
    this.notify()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
