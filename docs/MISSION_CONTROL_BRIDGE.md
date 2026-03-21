# Mission Control Bridge

The runtime implements the bridge contract frozen in `openclaw-agent`:

- dispatch intake: `POST /api/v1/mission-control/dispatches`
- callback target: `POST /api/v1/task-execution-runs/{run_id}/callbacks/symphony`

Bridge env vars:

- `MISSION_CONTROL_BASE_URL`
- `MISSION_CONTROL_BRIDGE_TOKEN`
- `MISSION_CONTROL_CALLBACK_TOKEN`
- `SYMPHONY_HTTP_BIND`
- `SYMPHONY_HTTP_PORT`

Source ownership for bridge behavior lives under `src/control-plane/`.
