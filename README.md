# Divebar

Round-trip your design system between Figma and code.

Divebar gives every component one spec your team owns. Figma and code both follow it. Edit either side, and the other catches up. 

Works with Cursor, Claude Code, and any agent that can call the Figma MCP.

## Setup

[Open in Cursor](https://cursor.com/link/prompt?text=I%20want%20to%20keep%20this%20project%20in%20sync%20with%20our%20Figma%20library.%20Run%20npx%20divebar%20init%2C%20walk%20me%20through%20the%20setup%2C%20and%20let%20me%20know%20when%20I%27m%20ready%20to%20start%20using%20it.)

To set up manually, open your terminal or agent and type:

```
npx divebar init
```

To install globally, use:

```
npm i -g divebar
```

Requires Node.js 18+ and Figma desktop with MCP enabled (editor seat).

## Features

- **Round-trip sync.** Pull from Figma into code, push from code back to Figma.
- **One spec per component.** Variants, slots, styles, and the link to Figma all live in a single file you can read and review.
- **Drift detection.** A lockfile tracks the last good state, so you find out before something silently overwrites your work.
- **Bootstrap from existing code.** Point Divebar at a component you already shipped and it scaffolds the spec for you.
- **Lint built in.** Catch missing styles, unknown tokens, and uncovered variant combinations before they ship.
- **Tokens with light and dark mode.** One shared token file, aliases supported, multi-mode out of the box.
- **Monorepo aware.** Each package can have its own framework and tokens.
- **Agent friendly.** Works with Cursor and Claude Code via MCP. Run `npx divebar init` to wire it up.

## Commands

**Setup**


| Command                  | What it does                                   |
| ------------------------ | ---------------------------------------------- |
| `init`                   | Walk through Figma MCP config for this project |
| `registry add`           | Register a component                           |
| `registry list`          | List registered components                     |
| `registry remove <name>` | Unregister a component                         |


**Components**


| Command            | What it does                                |
| ------------------ | ------------------------------------------- |
| `bootstrap <code>` | Scaffold a spec from existing code          |
| `pull <url>`       | Pull a component spec from a Figma URL      |
| `push <code>`      | Emit a Figma script that updates the design |
| `generate <spec>`  | Render code from a spec                     |
| `inspect <code>`   | Show the spec for a component               |
| `sync <name>`      | Reconcile Figma, code, and the lockfile     |
| `parse <spec>`     | Validate a spec                             |


**Tokens**


| Command                | What it does                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `tokens pull <tokens>` | Import a token JSON file into the spec                        |
| `tokens push`          | Emit a Figma script that updates token variables              |
| `tokens import`        | Import tokens from Figma Variables, DTCG, or Style Dictionary |


**Quality**


| Command       | What it does                                              |
| ------------- | --------------------------------------------------------- |
| `lint <name>` | Find missing styles and unknown tokens                    |
| `audit`       | Run audit rules against Figma and code                    |
| `mirror sync` | Snapshot every published component to disk                |
| `mirror diff` | Compare a previous mirror against the current Figma state |


Every command takes `--workspace <path>` for monorepos. Every Figma-touching command takes `--fixture <path>` for offline runs.

## Supported frameworks


| Framework    | Styling           |
| ------------ | ----------------- |
| React        | styled-components |
| React Native | StyleSheet        |


Open an issue if you want to see a specific framework or styling combination supported.

## License

MIT