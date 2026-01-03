# Evolu - Local First Landscape

This document provides accurate values for the [Local First Landscape](https://localfirstweb.dev/landscape) comparison.

```typescript
export const data = LandscapeSchema.make({
  Version: 1,
  Id: 'evolu',
  Name: 'Evolu',
  Description: 'Local-first platform designed for privacy, ease of use, and no vendor lock-in.',
  Website: 'https://www.evolu.dev',
  License: 'MIT',
  Deployment: ['Self-hosted', 'Hosted'],
  GitHub: "https://github.com/evoluhq/evolu",
  GetStarted: "https://www.evolu.dev/docs",
  InitialReleaseDate: new Date('2022-09-25'),
  MaturityLevel: "Production-Ready",
  AppTarget: {
    Platform: {
      data: ['Browser', 'Node', 'iOS', 'Android', 'Electron'],
      comment: 'iOS and Android support via React Native (Expo). Desktop via Electron.'
    },
    LanguageSDK: {
      data: ['TypeScript']
    },
    FrameworkIntegrations: {
      data: ['React', 'React Native', 'Expo', 'Svelte', 'Angular', 'Next.js']
    },
    ClientBundleSize: {
      data: '~200KB gzipped',
      comment: 'Includes SQLite WASM (~150KB) and core library (~50KB).'
    }
  },
  Networking: {
    Protocol: {
      data: ['WebSockets']
    },
    Topology: {
      data: 'Client-Relay',
      comment: 'Clients sync with relays. Relays do not sync with each other directly - clients sync relays eventually. P2P between clients is planned.'
    }
  },
  ServerSideData: {
    PersistenceMechanism: {
      data: ['SQLite'],
      comment: 'Relay uses SQLite (better-sqlite3 in Node.js) for storage.'
    },
    DataModelParadigm: {
      data: 'Opaque encrypted log',
      comment: 'Server stores encrypted CRDT messages. All data is end-to-end encrypted - relay cannot read content.'
    },
    SchemaManagement: {
      data: ['None'],
      comment: 'Server is schema-agnostic. It only stores encrypted binary blobs.'
    },
    ExistingDatabaseSupport: {
      data: 'Not supported',
      comment: 'Evolu is designed as a new database, not as a sync layer for existing databases.'
    },
    DataSize: {
      data: 'Unlimited',
      comment: 'No inherent limits on server storage. Practical limits depend on hosting infrastructure.'
    }
  },
  ClientSideData: {
    QueryAPI: {
      data: ['Async', 'Reactive subscriptions'],
      comment: 'Type-safe SQL queries via Kysely. Reactive subscriptions with automatic cache invalidation on mutations.'
    },
    LocalRefreshLatency: {
      data: '~1ms',
      comment: 'SQLite queries are synchronous and fast. UI updates are batched via React/framework integration.'
    },
    PersistenceMechanism: {
      data: ['IndexedDB', 'SQLite'],
      comment: 'Web: SQLite WASM with IndexedDB VFS. React Native: expo-sqlite or op-sqlite. Node.js: better-sqlite3.'
    },
    DataModel: {
      data: 'Relational',
      comment: 'Full SQLite relational model with typed schema using TypeScript.'
    },
    SchemaManagement: {
      data: ['Schema definition', 'Derived types', 'Schema migrations'],
      comment: 'Schema defined in TypeScript with compile-time type checking. Automatic migrations on schema changes.'
    },
    OfflineReads: {
      data: 'Full Support'
    },
    OfflineWrites: {
      data: 'Full Support',
      comment: 'All writes are local-first. Conflicts resolved automatically via CRDT.'
    },
    OptimisticUpdates: {
      data: 'Yes',
      comment: 'All mutations are immediately applied locally. No waiting for server confirmation.'
    },
    DataSize: {
      data: 'Limited by storage',
      comment: 'Web: Limited by IndexedDB quota. Native: Limited by device storage.'
    }
  },
  SynchronizationStrategy: {
    FullOrPartialReplication: {
      data: ['Partial Replication'],
      comment: 'Partial replication via Owners. Each Owner represents a separate data partition that can be independently synced or deleted.'
    },
    ConflictHandling: {
      data: 'Automatic via CRDT',
      comment: 'Last-write-wins (LWW) per field using hybrid logical clocks (HLC) for ordering.'
    },
    WhereResolutionOccurs: {
      data: 'Client',
      comment: 'Server stores encrypted data and cannot resolve conflicts. All conflict resolution happens on client.'
    },
    WhatGetsSynced: {
      data: {
        ClientToClient: 'Encrypted CRDT messages (timestamp + encrypted change)'
      }
    },
    Authority: {
      data: 'Decentralized',
      comment: 'No central authority. Any client can write at any time. Cryptographic ownership via SLIP-21 key derivation.'
    },
    Latency: {
      data: 'Close to network latency',
      comment: 'WebSocket-based real-time sync. Efficient Range-Based Set Reconciliation (RBSR) protocol for delta sync.'
    },
    Throughput: {
      data: 'Limited by WebSocket bandwidth',
      comment: 'Binary protocol optimized for size. Individual mutations limited to 640KB.'
    },
    Concurrency: {
      data: 'Optimistic concurrent writes',
      comment: 'Multiple devices can write simultaneously. Conflicts auto-resolved via CRDT.'
    }
  },
  AuthIdentity: {
    Encryption: {
      data: 'Yes',
      comment: 'Built-in end-to-end encryption using XChaCha20-Poly1305. All data is encrypted before leaving the client.'
    },
    AuthenticationMethod: {
      data: ['Built-in'],
      comment: 'Cryptographic identity via BIP-39 mnemonic. Can be created from external keys (e.g., hardware wallet).'
    },
    AuthorizationPermissions: {
      data: 'Owner-based access control',
      comment: 'Data ownership via cryptographic keys. SharedOwner for collaborative write access, SharedReadonlyOwner for read-only sharing.'
    }
  },
  UIRelated: {
    RichTextEditing: {
      data: 'No',
      comment: 'No built-in rich text support. Can be implemented using external editors with Evolu as storage.'
    },
    Components: {
      data: [],
      comment: 'No built-in UI components. Evolu is a data layer, not a UI framework.'
    }
  },
  DevelopmentWorkflowsDX: {
    DebuggingTools: {
      data: ['Console logging', 'Error subscriptions'],
      comment: 'Subscribe to errors via evolu.subscribeError(). Full TypeScript types for all operations.'
    },
    CLI: {
      data: 'No CLI',
      comment: 'Relay can be run via Docker or programmatically. No separate CLI tool.'
    },
    TypeSupport: {
      data: 'Full type support without extra config',
      comment: 'First-class TypeScript. Schema types flow through queries to results. Compile-time validation of mutations.'
    }
  }
});
```