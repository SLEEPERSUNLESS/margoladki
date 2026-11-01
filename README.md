# Margonem – clan fee tracker

Userscript for [Margonem](https://www.margonem.pl) (new interface) that records gold deposits from the clan history
and compares them with the list of clan members and their required fees.

## Features

- Reads deposits (`+N złota /Nick`) from the clan history and stores them locally
- Picks up the member list and levels from the clan treasury / member tabs
- Per-player required fees, including progressive fees based on character level thresholds
- Report with paid / required / balance per player, sorting and search
- Alt-account (multikonto) and blacklist marking, nickname migration after a name change
- Backup export / import (JSON) and optional Discord webhook upload of backups and report screenshots

## Installation

1. Install a userscript manager, e.g. [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Open [`skladki-klanowe.user.js`](skladki-klanowe.user.js), click **Raw** – the manager will offer to install it.
3. Log in to Margonem and open the clan window (history / treasury) – data is collected automatically.

## Usage

Buttons are added to the clan window. Additional commands are available in the browser console (F12):

| Command | Description |
| --- | --- |
| `skladki.raport()` | Show the fee report |
| `skladki.kopia()` / `skladki.wczytajKopie()` | Export / import a backup |
| `skladki.ustawStart('DD.MM.YYYY')` | Ignore history entries older than the given day |
| `skladki.migrujNick('old', 'new')` | Move data after a nickname change |
| `skladki.ustawWebhook(url)` | Set a Discord webhook for backups |
| `skladki.ustawWebhookKlanowy(url)` | Set a Discord webhook for clan reports |
| `skladki.usunWebhook()` / `skladki.usunWebhookKlanowy()` | Disable Discord uploads |

Discord webhooks are **not** bundled with the script – each user sets their own.

## Data

All data is kept in the browser's `localStorage` (keys prefixed with `klanSkladki`). Nothing is sent anywhere
unless a Discord webhook is configured.
