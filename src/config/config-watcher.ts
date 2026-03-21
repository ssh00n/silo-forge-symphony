import { watch, type FSWatcher } from "chokidar";
import { log } from "../logging/logger.js";

export class ConfigWatcher {
  private watcher: FSWatcher | null = null;

  async start(
    filePath: string,
    onChange: () => void,
  ): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }

    this.watcher = watch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on("change", () => {
      log.info(`Workflow file changed: ${filePath}`);
      onChange();
    });

    this.watcher.on("error", (err) => {
      log.error(`Config watcher error: ${err instanceof Error ? err.message : String(err)}`);
    });

    log.info(`Watching workflow file: ${filePath}`);
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
