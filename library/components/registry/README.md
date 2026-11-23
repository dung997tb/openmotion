# Studio motion component registry

The packaged directory contains manifest metadata from the [HyperFrames registry](https://github.com/heygen-com/hyperframes/tree/8c799ebd1b673dc2a61a06b0ba4e283c1b42b2f4/registry), licensed under the included Apache 2.0 license. The cloud API serves cards from this snapshot. Installing one item downloads its declared files from the recorded release or the upstream asset CDN, then commits the missing files to the project. Fragment-style components receive a composition root when installed. The blur-in regression fixture in tests/fixtures/motion-components reproduces the source file from the same revision and license. Individual assets retain their original notices.

To refresh the directory, check out the release tag matching the project's pinned HyperFrames dependency and run `node scripts/import-motion-component-registry.ts /path/to/hyperframes`.
