# Pipeline WebSocket Hooks

## Namespace

`/api/socket/pipelineProgress`

## Event Types

```typescript
/** Pipeline progress event types */
export type PipelineEventType =
  | "pipeline:started"
  | "pipeline:phase-start"
  | "pipeline:phase-progress"
  | "pipeline:phase-complete"
  | "pipeline:review-required"
  | "pipeline:review-result"
  | "pipeline:completed"
  | "pipeline:failed";

/** Base event payload */
interface PipelineEventBase {
  pipelineId: string;
  phase?: string;
  timestamp?: number;
}

/** Pipeline started */
export interface PipelineStartedEvent extends PipelineEventBase {
  projectId: number;
  currentPhase: string;
}

/** Phase started */
export interface PipelinePhaseStartEvent extends PipelineEventBase {
  phase: string;
  phaseOrder: number;
}

/** Phase progress update */
export interface PipelinePhaseProgressEvent extends PipelineEventBase {
  phase: string;
  progress: number; // 0–100
  message?: string;
}

/** Phase completed */
export interface PipelinePhaseCompleteEvent extends PipelineEventBase {
  phase: string;
  status: "completed" | "failed";
  outputCount?: number;
}

/** Review required for a phase */
export interface PipelineReviewRequiredEvent extends PipelineEventBase {
  phase: string;
  status: "awaiting-review";
}

/** Review result */
export interface PipelineReviewResultEvent extends PipelineEventBase {
  reviewId: string;
  shotId: string;
  phase: string;
  action: "approve" | "reject" | "revise";
  feedback?: string | null;
}

/** Pipeline completed */
export interface PipelineCompletedEvent extends PipelineEventBase {
  totalTimeMs?: number;
}

/** Pipeline failed */
export interface PipelineFailedEvent extends PipelineEventBase {
  error?: string;
  phase?: string;
}

/** Union of all event payloads */
export type PipelineEvent =
  | PipelineStartedEvent
  | PipelinePhaseStartEvent
  | PipelinePhaseProgressEvent
  | PipelinePhaseCompleteEvent
  | PipelineReviewRequiredEvent
  | PipelineReviewResultEvent
  | PipelineCompletedEvent
  | PipelineFailedEvent;
```

## React Hook: `usePipelineProgress`

```tsx
import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  PipelineEventType,
  PipelineEvent,
} from "./pipeline-events"; // adjust import path

interface UsePipelineProgressOptions {
  /** Backend WebSocket base URL, e.g. "http://localhost:3000" */
  url: string;
  /** Pipeline run ID to subscribe to */
  pipelineId: string;
  /** Called for every pipeline event */
  onEvent?: (type: PipelineEventType, data: PipelineEvent) => void;
  /** Shorthand callbacks */
  onStarted?: (data: PipelineEvent) => void;
  onPhaseProgress?: (data: PipelineEvent) => void;
  onPhaseComplete?: (data: PipelineEvent) => void;
  onReviewRequired?: (data: PipelineEvent) => void;
  onReviewResult?: (data: PipelineEvent) => void;
  onCompleted?: (data: PipelineEvent) => void;
  onFailed?: (data: PipelineEvent) => void;
  /** Auto-connect (default: true) */
  autoConnect?: boolean;
}

interface PipelineHistory {
  pipelineId: string;
  projectId: number;
  state: string;
  currentPhase: string;
  currentPhaseOrder: number;
  createTime: number;
  updateTime: number;
  config?: string;
  auditTrail: Array<{
    id: number;
    action: string;
    result: string;
    detail: string;
    createTime: number;
  }>;
}

export function usePipelineProgress(options: UsePipelineProgressOptions) {
  const {
    url,
    pipelineId,
    onEvent,
    onStarted,
    onPhaseProgress,
    onPhaseComplete,
    onReviewRequired,
    onReviewResult,
    onCompleted,
    onFailed,
    autoConnect = true,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [history, setHistory] = useState<PipelineHistory | null>(null);

  const eventMap: Record<PipelineEventType, ((data: PipelineEvent) => void) | undefined> = {
    "pipeline:started": onStarted,
    "pipeline:phase-start": undefined,
    "pipeline:phase-progress": onPhaseProgress,
    "pipeline:phase-complete": onPhaseComplete,
    "pipeline:review-required": onReviewRequired,
    "pipeline:review-result": onReviewResult,
    "pipeline:completed": onCompleted,
    "pipeline:failed": onFailed,
  };

  useEffect(() => {
    if (!autoConnect || !pipelineId) return;

    const socket = io(`${url}/api/socket/pipelineProgress`, {
      transports: ["websocket"],
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // Subscribe to this pipeline
      socket.emit("pipeline:subscribe", { pipelineId });
      // Fetch history
      socket.emit("pipeline:history", { pipelineId }, (result: PipelineHistory) => {
        if (result && !result.error) {
          setHistory(result);
        }
      });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    // Register all event listeners
    const eventTypes: PipelineEventType[] = [
      "pipeline:started",
      "pipeline:phase-start",
      "pipeline:phase-progress",
      "pipeline:phase-complete",
      "pipeline:review-required",
      "pipeline:review-result",
      "pipeline:completed",
      "pipeline:failed",
    ];

    for (const eventType of eventTypes) {
      socket.on(eventType, (data: PipelineEvent) => {
        onEvent?.(eventType, data);
        eventMap[eventType]?.(data);
      });
    }

    return () => {
      socket.emit("pipeline:unsubscribe", { pipelineId });
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [url, pipelineId, autoConnect]);

  const fetchHistory = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    socket.emit("pipeline:history", { pipelineId }, (result: PipelineHistory) => {
      if (result && !result.error) {
        setHistory(result);
      }
    });
  }, [pipelineId]);

  return { connected, history, fetchHistory, socket: socketRef };
}
```

## Usage Example

```tsx
import { usePipelineProgress } from "./hooks/usePipelineProgress";

function PipelineDashboard({ pipelineId }: { pipelineId: string }) {
  const { connected, history } = usePipelineProgress({
    url: "http://localhost:3000",
    pipelineId,
    onPhaseProgress: (data) => {
      console.log(`${data.phase}: ${data.progress}%`);
    },
    onReviewRequired: (data) => {
      alert(`Review needed for phase: ${data.phase}`);
    },
    onCompleted: () => {
      console.log("Pipeline finished!");
    },
    onFailed: (data) => {
      console.error("Pipeline failed:", data.error);
    },
  });

  return (
    <div>
      <p>Status: {connected ? "🟢 Connected" : "🔴 Disconnected"}</p>
      {history && (
        <p>Current: {history.currentPhase} ({history.state})</p>
      )}
    </div>
  );
}
```

## Client → Server Events

| Event                 | Payload                      | Description                      |
|-----------------------|------------------------------|----------------------------------|
| `pipeline:subscribe`  | `{ pipelineId: string }`     | Subscribe to a pipeline run      |
| `pipeline:unsubscribe`| `{ pipelineId: string }`     | Unsubscribe from a pipeline run  |
| `pipeline:history`    | `{ pipelineId: string }`     | Request historical progress      |

## Server → Client Events

| Event                     | When                                        |
|---------------------------|---------------------------------------------|
| `pipeline:started`        | Pipeline run created                        |
| `pipeline:phase-start`    | A new phase begins                          |
| `pipeline:phase-progress` | Phase progress update (0–100)               |
| `pipeline:phase-complete` | Phase finished (completed/failed)           |
| `pipeline:review-required`| Phase completed, awaiting human review      |
| `pipeline:review-result`  | Review decision made (approve/reject/revise)|
| `pipeline:completed`      | Entire pipeline finished                    |
| `pipeline:failed`         | Pipeline run failed                         |
