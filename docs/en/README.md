<div align="center">

# KotaMusic

**A modification for the [Yandex Music](https://music.yandex.ru/download/) desktop client**

Discord Rich Presence, a mini player, global hotkeys and other things
the stock client is missing.

[![Discord](https://img.shields.io/badge/Discord-Server-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.com/invite/XYBvdvfv8t)
[![Site](https://img.shields.io/badge/Site-lvl.su-ff5c5c?style=flat-square)](https://lvl.su/)
[![Telegram](https://img.shields.io/badge/Telegram-Kotamarine-229ED9?style=flat-square&logo=telegram&logoColor=white)](https://t.me/kotamarine)
[![Русский](https://img.shields.io/badge/Язык-Русский-lightgrey?style=flat-square)](../../README.md)
[![English](https://img.shields.io/badge/Language-English-blue?style=flat-square)](README.md)

[![Downloads](https://img.shields.io/github/downloads/AveHarrisan/KotaMusic/total?label=Downloads&style=flat-square)](https://github.com/AveHarrisan/KotaMusic/releases)
[![Latest build](https://img.shields.io/github/v/release/AveHarrisan/KotaMusic?label=Build&style=flat-square)](https://github.com/AveHarrisan/KotaMusic/releases/latest)
![Windows](https://img.shields.io/badge/Windows-supported-blue?style=flat-square)
![Linux](https://img.shields.io/badge/Linux-supported-blue?style=flat-square)
![macOS](https://img.shields.io/badge/macOS-in_progress-lightgrey?style=flat-square)

</div>

> [!IMPORTANT]
> The mod **does not replace a Yandex Plus subscription** and does not remove
> track protection. You need the official client and an active subscription.

---

## Installation

1. Install the official client — **[music.yandex.ru/download](https://music.yandex.ru/download/)**
2. Download the KotaMusic installer from the [releases page](https://github.com/AveHarrisan/KotaMusic/releases)
3. Close Yandex Music and run the installer
4. Press "Install" and wait for it to finish

Mod settings live inside the client: **Settings → KotaMusic**.

<details>
<summary>Removing the mod</summary>

Open the installer and press "Remove". The original client is restored from
the backup made during installation — reinstalling Yandex Music is not needed.

</details>

<details>
<summary>Manual installation, without the installer</summary>

Every release contains an `app.asar` file. Put it into the client folder,
replacing the existing one:

- **Windows** — `%localappdata%\Programs\YandexMusic\resources\`
- **Linux** — `/opt/Яндекс Музыка/resources/`

On Windows that is not enough: the client verifies the file's integrity and
refuses to start after a plain replacement. The installer patches that check,
so manual installation only makes sense on Linux.

</details>

---

## Features

### Discord Rich Presence

<details open>
<summary>What it shows</summary>

Track title, artists, album and cover art. The title and the artist are
clickable — they lead to the track and artist pages on the Yandex Music
site. Elapsed time is shown either as a progress bar in the profile card
or as a counter, which is also visible in the voice channel card. The
track title can replace the app name in the member list, and two buttons
sit under the status.

Works both in the regular player and in "Моя волна" (My Wave).

</details>

### Mini player

<details open>
<summary>How it looks</summary>

![Mini player](../images/miniplayer.png)

A small always-on-top window: cover art, scrolling title, artist, time and
progress bar; play, next, previous, volume with a percentage readout and
seeking by clicking the bar.

- **Compact mode** — a shorter, narrower window
- **Hide while nothing plays** — the window disappears instead of showing
  "nothing is playing" and comes back with the first track
- **Pinning** — the window becomes semi-transparent and stops catching the
  mouse; a hotkey unpins it for a set number of seconds
- **Resizable** with a remembered size and position, optionally shown in
  the taskbar

</details>

### Now playing overlay for streams

<details open>
<summary>For OBS and friends</summary>

![Overlay](../images/stream.png)

The mod serves a page at `http://127.0.0.1:8462/` — add it to OBS as a
Browser source. The address is bound to the local machine only, so the
overlay is not reachable from the network.

Almost everything is configurable: dark, light or fully transparent
backdrop, cover art and its size, progress bar, numeric time, custom
colours for the title, artist and time, text size and a fixed width — the
overlay never jumps around when a long title arrives, it scrolls instead.
Changes apply instantly, no need to reload the source in OBS. The settings
page shows a live preview.

![Overlay settings](../images/settings-stream.png)

</details>

### Window and system

<details open>
<summary>How the client behaves</summary>

![Window and system](../images/settings-window.png)

- **Close to tray** — the close button hides the window, music keeps playing
- **Start with the system** and **start minimized**
- **Remember window size** and **startup page**
- **Hardware acceleration** — turn it off if the picture flickers
- **Control this computer from other devices** — your phone or speaker can
  switch tracks here

</details>

### Global hotkeys

<details>
<summary>What can be bound</summary>

They work over other windows — from a game, a browser, anywhere.

Play / pause, next and previous track, volume up and down, like, repeat,
shuffle, show the mini player and unpin it.

No combination is bound by default: pick your own so they do not clash with
other programs. Click the field and press a combination, `Backspace` clears
it. A combination already taken by another program is highlighted in red.

![Hotkeys](../images/settings-hotkeys.png)

</details>

### Player bar and everything else

<details>
<summary>The list</summary>

- **Always show track time** — normally it appears only on hover
- **No recolouring from the cover art** — the bar stays dark
- **Thicker progress bar** — easier to hit when seeking
- **Static backdrop instead of the My Wave animation** — for weak machines
- **Taskbar thumbnail buttons on Windows** — control playback without
  restoring the window
- **Volume percentage** — a short hint next to the slider, with a custom
  wheel step
- **The computer is visible to Yandex sync** — the client announces itself
  as "player only", and the mod lifts that restriction. The desktop client
  has no device picker of its own; switching is done from the phone
- **Interface scale** — from 50 to 200 percent
- **Keep the screen awake while music plays**

</details>

---

## Settings

Everything is managed inside the client: **Settings → KotaMusic**. Changes
apply immediately unless stated otherwise.

There are more than sixty settings, so they are grouped into collapsible
sections — only the headings with a count are visible at first.

![Settings](../images/settings-sections.png)

---


## How it works

This repository contains only our own code: the mod layer and the patch
definitions. None of Yandex's code is stored here — the build downloads the
official installer, takes `app.asar` out of it, applies the patches and packs
it back.

Builds are produced automatically: the client version is checked every three
hours, and a fresh mod is built for every new one. If a patch no longer fits,
the build fails, an issue is opened, and a broken release is never published.

<details>
<summary>Building it yourself</summary>

```bash
npm install
node scripts/build.js --platform=win32   # win32 | linux | darwin
```

The result is `dist/app.asar` plus `dist/build-info.json` with the client
version and a per-patch report. Unpacking installers needs `ar` and `tar`
on Linux and `7z` for Windows and macOS.

Installing a local build into a client:

```bash
node scripts/install-local.js --client="/path/to/client"
node scripts/install-local.js --client="/path/to/client" --restore
```

</details>

<details>
<summary>Layout</summary>

```
mod/        mod code, goes into app.asar as a separate folder
patches/    injections into the client; each one reports if it no longer fits
scripts/    building and working with the official client distribution
installer/  the installer window
docs/       roadmap and images
```

</details>

---

## What's next

Plans and what is already done — in [ROADMAP.md](../ROADMAP.md) (in Russian).
Found a bug or want a feature — [open an issue](https://github.com/AveHarrisan/KotaMusic/issues).

## Questions and chat

Discord server — **[discord.com/invite/XYBvdvfv8t](https://discord.com/invite/XYBvdvfv8t)**.

Elsewhere: **[lvl.su](https://lvl.su/)** — game guides and wikis,
**[Kotamarine](https://t.me/kotamarine)** — Telegram channel about games,
**[AveHarrisan](https://t.me/aveharrisan)** — the author's Telegram.

The mod carries on the idea of the discontinued **YandexMusicModClient**:
the same kind of features, but a separate implementation with automatic
builds for current client versions.

## Support

- **[Boosty](https://boosty.to/aveharrisan)**
- **[DonationAlerts](https://www.donationalerts.com/r/aveharrisan)**
