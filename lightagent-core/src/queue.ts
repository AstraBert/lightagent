interface QueueItem<T> {
  chunk?: T;
  done?: boolean;
  isError?: boolean;
  isInterrupt?: boolean;
}

export class AsyncQueue<T> {
  private items: QueueItem<T>[] = [];
  private resolvers: ((item: QueueItem<T>) => void)[] = [];

  push(item: QueueItem<T>) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve(item);
    } else {
      this.items.push(item);
    }
  }

  // deno-lint-ignore require-await
  async next(): Promise<QueueItem<T>> {
    if (this.items.length > 0) {
      return this.items.shift()!;
    }
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
}
