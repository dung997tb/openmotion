# Project editing contract

A Studio gesture and a remote MCP call with the same intent and base files must produce the same saved work. This contract applies when adding or migrating an edit. Individual commands become available as their Studio and cloud entry points land.

| Caller | Responsibility |
| --- | --- |
| Studio | Show gesture feedback immediately. When the API advertises text edits and Studio has the source for the command, run the shared transformation, then submit one batch of file changes asynchronously. Keep playback, selection, zoom and clipboard reads in the browser. |
| Remote Agent | Discover the composition path and stable element IDs from the project. Submit an intent or explicit file contents through MCP with the observed project version. Editing must work with all browsers closed. |
| HTTP and MCP handlers | Accept computed file changes or semantic commands. The cloud executor loads the required sources for semantic commands and runs edit-core. Both paths use the same project transaction for changes, history and notification. |
| edit-core | Own the meaning of each editing action. Given the same source, targets and command, compute the same changes in Studio and headless execution. Reuse the Hyperframes SDK and existing source, GSAP, split and caption transformations internally. Storage, network requests, DOM measurements and project history belong to callers. |

## What drives the timeline

A project's composition HTML stores clip timing and track placement. For example, the [Paperwing composition](../../examples/wing-construction/index.html) places its audio clip with `data-start`, `data-duration` and `data-track-index`. Studio derives the visible timeline from this content. A browser or headless caller can run edit-core with the current source and a command to produce the next source.

When a user trims a ten-second clip to six seconds, Studio must keep showing six seconds while the save is in flight. The mounted player may still describe the ten-second version it loaded. Receiving that description is a read and must never write a project file, add an undo step, or replace the pending timing. A confirmed edit from another client, an explicit undo or redo, or a rejected save can legitimately change what Studio displays.

## Choosing the unit of work

- **Trim a clip.** At normal playback speed, a clip covering timeline seconds 5–9 and starting at source second 10 becomes timeline seconds 6–9 and starts at source second 11 after a one-second left trim. The core applies the trim's linked-audio and animation rules in that edit. A move has different semantics even when it changes the same time attribute.
- **Edit several elements.** Send one property edit for the selected IDs and the properties being changed, such as text, font size or color. Use an ordered batch when one user action spans commands or files. Resolve each target in its source file, and reject the batch if a required target is missing or ambiguous. Each command sees the preceding changes in its batch.
- **Rewrite a composition.** An Agent that has authored complete HTML, CSS or JavaScript can submit the changed files together through the existing file-edit interface. Honor explicit source edits as authored, with the same concurrency, history and event guarantees. A file diff does not convey a gesture such as trimming or splitting.

Canvas geometry can depend on the rendered viewport. Studio can measure it as input to a command. A headless caller supplies the necessary values or uses a source-level edit. A persisted rule must be executable without a browser selection, an iframe, or per-property network calls.

## Saving and collaboration

1. With `TEXT_PATCH_WRITES=true`, Studio submits an `Idempotency-Key`, the file version it edited, and the versions of other inputs the command depended on. Each replacement is a tuple of UTF-8 byte offset, deleted byte count and inserted text. All offsets refer to the original file. Large rewrites can supply full contents. The service checks every input in the commit transaction. Changes to unrelated files can succeed concurrently. A stale input rejects the whole batch with HTTP 409. The legacy command endpoint retains its prior behavior while patch writes are disabled.
2. Keep dependent writes atomic. Commit the edits with one server-generated action label and one project history step, then publish the project change via SSE. A no-op adds no undo step. Uploading media and placing that media on a timeline are distinct actions.
3. After an uncertain response, retry the same payload with its original request ID. A conflict requires reconciling local changes against the latest source. Surface a rejected edit in Studio so the visible state and saved state agree.
4. Undo and redo follow one durable, chronological history per project, across all editors and Agents. If Studio moves a title and an Agent then changes a caption, the first undo restores the caption and the second restores the title. SDK session history and browser state cannot determine that order. PostgreSQL records the project versions and history. File storage holds the referenced contents.

Studio groups the automatic saves from one typing burst or compound gesture into one project undo step. Each accepted save creates its own immutable version, so an earlier revision remains readable. Only consecutive saves from the same authenticated user and explicit gesture may advance that undo step. A separately confirmed command, another client's independent gesture, or an MCP edit starts its own step. Retrying a request with its original ID returns the original version.

### Reading a saved file

A small patch creates an immutable file revision in PostgreSQL. When a second Studio receives the project's SSE event, it can request changes since its confirmed file version. A reader without a matching base can request the complete contents. The API, preview and export workers reconstruct the requested version from a complete baseline plus the following patches. Before the chain would exceed 32 patches or 256 KiB, the service writes a new baseline. A downloadable file uses a materialized, content-addressed blob. A file version stays valid when a new baseline is produced.

Remote agents can use `openmotion_get_project` with `file.path`. The default mode reads text. Use `download` for a signed URL or `sync` with a previously observed file version for incremental updates. Pin the returned version when continuing a paged read or renewing a URL.

## Extending and verifying an edit

Start with an existing command when the intent and affected files match. Add a command for a distinct editing rule, such as split or trim. Keep transport-specific checks in the service and each transformation in one place. Start with the [command dispatcher](../../packages/edit-core/commands.ts), [wire schema](../../packages/edit-core/schema.ts) and [cloud executor](../../src/services/project-edit.ts).

Exercise a migrated action through Studio and remote MCP on identical input. Compare saved contents and undo results. For batches, cover multiple targets, a failing target, a stale version and a retried request. For collaboration, verify that another open Studio receives the resulting change. Count edit writes separately from reads for previews and the SSE subscription.
