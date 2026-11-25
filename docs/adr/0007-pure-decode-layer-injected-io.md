# Keep the decode layer pure and inject its IO

`src/heronite` is a decoder: paths and file contents in, library entries out. Effect's `FileSystem` and
`Path` services stay out of it. Its pure data tooling does not: `Schema` decodes every file and
`Predicate` supplies the guards, because the Effect guide forbids hand-rolling either. Every effectful dependency is a function parameter instead — `readJson`
takes a `JsonReader`, `dirAccess` and `chooseTransport` take `exists`/`list`/`platform`, and the
`Effect.sync(...)` wrappers live one layer up in `src/plugin.ts` and `src/kit/library-with-ui.ts`.

Effect's filesystem services pay for themselves when IO is concurrent, streamed, retried on a
schedule, or owns a resource whose lifetime must be scoped. None of that is true here: one sync reads a
handful of small JSON documents once, sequentially, with no handle kept open. What the services would
add is a `FileSystem` requirement on every parser, filter and mapping function and an Effect runtime in
every one of the 216 tests, which today run in about a second with plain values.

Documents are decoded with schemas, so a shape change in Heronite is refused at the boundary instead
of arriving as `undefined` fields deep in the readers. The schemas are deliberately as permissive as
the readers are: a value of the wrong type is dropped and the document kept (a download size written
as a number must not cost the queue), while containers — arrays, records, the document itself — must
have the shape the code iterates. `lax()` in `schemas.ts` is that rule, in one place.

The trade this makes is explicit, and its cost is a rule that has to hold: **nothing under
`src/heronite` may throw**. `readFileSync`, `readdirSync` and `statSync` are each wrapped and turned
into a value — a missing, unreadable, empty or malformed file is `undefined`, a folder that cannot be
listed is empty, a directory that cannot be stat'd is `missing`. `Effect.sync` around these functions is
therefore safe, because their failure modes are already in their return type. Wherever Effect code
touches the filesystem itself, it uses `Effect.try`, not `Effect.sync`, so an `EACCES` on a snapshot
path becomes a `ParitySnapshotError` — a tagged error naming the operation and the file — instead of
a defect that kills the fiber.

The rejected alternative is Effect's `FileSystem` throughout, which would make the seam uniform but buy
capabilities this plugin does not use. Revisit if the scan ever becomes incremental, parallel across
roots, or long-lived enough to hold resources open.
