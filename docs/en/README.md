<div align="center">

# KotaMusic

**A modification for the [Yandex Music](https://music.yandex.ru/download/) desktop client**

Discord Rich Presence, a mini player, global hotkeys and other things
the stock client is missing.

[![Discord](https://img.shields.io/badge/Discord-Server-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.com/invite/XYBvdvfv8t)
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

Track title, artists, album and cover art. Elapsed time is shown either as
a progress bar in the profile card or as a counter — your choice. The title
and the artist are clickable, and there are two buttons under the status.

Works both in the regular player and in "Моя волна" (My Wave).

</details>

### Mini player

<details open>
<summary>How it looks</summary>

![Mini player](../images/miniplayer.png)

A small always-on-top window: cover art, title, seeking by clicking the bar,
volume behind a button with a percentage readout. Every element can be hidden.

</details>

### Global hotkeys

<details>
<summary>Defaults and how to change them</summary>

They work over other windows — from a game, a browser, anywhere.

| Action | Default |
| --- | --- |
| Play / pause | `Ctrl+Alt+Space` |
| Next track | `Ctrl+Alt+→` |
| Previous track | `Ctrl+Alt+←` |
| Volume up / down | `Ctrl+Alt+↑` / `Ctrl+Alt+↓` |
| Like | `Ctrl+Alt+L` |
| Show mini player | not set |

Any combination can be changed in the settings: click the field and press
your own. `Backspace` clears a binding, "Вернуть по умолчанию" restores
the whole set.

![Hotkeys](../images/settings-hotkeys.png)

</details>

### Everything else

<details>
<summary>The list</summary>

- **Taskbar thumbnail buttons on Windows** — control playback without
  restoring the window
- **Volume percentage** — a short hint next to the slider
- **Controlling other devices** — run your phone or speaker from the desktop
- **Interface scale** — from 50 to 200 percent
- **Custom cache folder** — keep it off the system drive
- **Keep the screen awake while music plays**

</details>

---

## Settings

Everything is managed inside the client and applied immediately.

![Settings](../images/settings.png)

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

The mod carries on the idea of the discontinued **YandexMusicModClient**:
the same kind of features, but a separate implementation with automatic
builds for current client versions.

## Support

- **[Boosty](https://boosty.to/aveharrisan)**
- **[DonationAlerts](https://www.donationalerts.com/r/aveharrisan)**
