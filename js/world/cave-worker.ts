import { buildCaveChunkMesh } from "./cave-mesh.ts";
import type {
  CaveWorkerRequest,
  CaveWorkerResponse,
} from "./cave-worker-protocol.ts";

interface CaveWorkerScope {
  onmessage: ((event: MessageEvent<CaveWorkerRequest>) => void) | null;
  postMessage(message: CaveWorkerResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as CaveWorkerScope;
let heights: Float32Array | null = null;
let surfaceColors: Float32Array | null = null;
let caveColor: readonly [number, number, number] = [0.3, 0.25, 0.2];

scope.onmessage = (event): void => {
  const request = event.data;
  switch (request.kind) {
    case "initialize":
      heights = request.heights;
      surfaceColors = request.surfaceColors;
      caveColor = request.caveColor;
      scope.postMessage({ kind: "ready" });
      return;
    case "mesh": {
      if (heights === null || surfaceColors === null) {
        scope.postMessage({
          kind: "error",
          key: request.key,
          revision: request.revision,
          message: "Cave worker received mesh work before initialization.",
        });
        return;
      }
      try {
        const mesh = buildCaveChunkMesh({
          coordinate: request.coordinate,
          heights,
          surfaceColors,
          brushes: request.brushes,
          caveColor,
          includeSurface: request.includeSurface,
        });
        scope.postMessage(
          {
            kind: "mesh",
            key: request.key,
            revision: request.revision,
            positions: mesh.positions,
            normals: mesh.normals,
            colors: mesh.colors,
          },
          [
            mesh.positions.buffer,
            mesh.normals.buffer,
            mesh.colors.buffer,
          ],
        );
      } catch (error) {
        scope.postMessage({
          kind: "error",
          key: request.key,
          revision: request.revision,
          message:
            error instanceof Error
              ? error.message
              : "Unknown cave meshing error.",
        });
      }
      return;
    }
    default: {
      const exhaustive: never = request;
      throw new Error(`Unknown cave worker request: ${String(exhaustive)}`);
    }
  }
};
