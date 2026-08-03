# Xenia-DWServer

**Call of Duty: Black Ops 2 DemonWare server emulator for Xenia (Xbox 360 emulator).**

Restores online functionality for BO2 on Xenia. Handles stats, leaderboards, matchmaking, file storage, profiles, anticheat, and more over the original binary protocol.

## What it does

- **Stats** — Parses and serves MP and Zombies stats (kills, deaths, score, rank, prestige, etc.)
- **Leaderboards** — Global and per-map leaderboards for both MP and ZM
- **Matchmaking** — Session creation, group management, and player matching
- **File Storage** — User stats files and publisher files with MongoDB persistence
- **Profiles** — Player profile read/write
- **Anticheat** — Heartbeat and validation checks
- **Rich Presence** — Player status broadcasting
- **League** — League season data
- **Content Streaming** — Theater/clip support
- **Tags** — Player tags

## Tech stack

- **NestJS** + **TypeScript** — Application framework
- **MongoDB** — Data storage (stats files, sessions, clips)
- **Custom TCP server** — Binary protocol handler (not HTTP)
- **Stats parser** — Bit-level DDL parser for BO2's stats format

## Protocol

The server speaks the original DemonWare binary protocol over TCP. No modifications to the game or Xenia are needed — the server implements the same wire format the official servers used.

- Bit-packed authentication (XUID + gamertag + title ID)
- Tagged binary serialization for request/response bodies
- Per-service routing (stats, storage, matchmaking, etc.)
- Keepalive heartbeat

## Getting started

```bash
# Install
npm install

# Build
npm run build

# Run
npm start
```

Server listens on **port 30003**.

### Requirements

- Node.js 18+
- MongoDB instance
- Xenia with BO2 configured to point at this server

### Environment

Set your MongoDB connection string in `src/app.module.ts` (or use environment variables).

## Performance

- Write-back stats cache (5-min flush to MongoDB, instant replies to game)
- Pre-allocated receive buffers with zero-copy compaction
- Single-buffer frame construction
- Batch session queries for matchmaking
- Async file I/O for publisher files

## Project structure

```
src/
├── core/                    # TCP server, connection, protocol, binary read/write
├── application/
│   ├── handlers/            # Service handlers (stats, storage, matchmaking, etc.)
│   ├── services/            # Stats parser, stats cache
│   └── schemas/             # DDL stat definitions (JSON)
├── infrastructure/          # MongoDB repositories, Xbox presence client
└── app.module.ts            # Module wiring + service registration
```

## Supported title

- **Call of Duty: Black Ops 2** (TU17) — Title ID `0x47DB` / `41560817`

## License

This project is for educational and preservation purposes. Not affiliated with Activision or Treyarch.

## Keywords

Black Ops 2, BO2, DemonWare, DWServer, Xenia, Xbox 360, emulator, server emulator, Call of Duty, Black Ops 2 online, BO2 multiplayer, BO2 zombies, leaderboards, stats, NestJS, TypeScript, MongoDB, reverse engineering, game server, private server, TU17, title update 17, Xbox Live, online play, preservation
