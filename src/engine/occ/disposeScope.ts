export interface OccDisposable {
  dispose(): void;
}

export class OccDisposeScope {
  private readonly disposables: OccDisposable[] = [];
  private disposed = false;

  track<T extends OccDisposable>(disposable: T): T {
    if (this.disposed) {
      disposable.dispose();
      return disposable;
    }
    this.disposables.push(disposable);
    return disposable;
  }

  release<T extends OccDisposable>(disposable: T): T {
    const index = this.disposables.indexOf(disposable);
    if (index >= 0) this.disposables.splice(index, 1);
    return disposable;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (let index = this.disposables.length - 1; index >= 0; index -= 1) {
      try {
        this.disposables[index].dispose();
      } catch {
        // Best effort cleanup; later diagnostics should report operation errors.
      }
    }
    this.disposables.length = 0;
  }
}

export async function withOccDisposeScope<TResult>(
  run: (scope: OccDisposeScope) => Promise<TResult> | TResult,
): Promise<TResult> {
  const scope = new OccDisposeScope();
  try {
    return await run(scope);
  } finally {
    scope.dispose();
  }
}
