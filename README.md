# Coffee Pub Minstrel

![Latest Release](https://img.shields.io/github/v/release/Drowbe/coffee-pub-minstrel)
![Foundry v13](https://img.shields.io/badge/foundry-v13-yellow)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

Run your game's soundtrack from one window instead of hunting through the playlist sidebar mid-scene.

Minstrel is an audio console for the table: your music, ambience and sound effects laid out the way
you actually use them, reusable sound scenes you start with one click, and rules that change the
soundtrack for you when combat starts or the party reaches a new map.

## What it does

- **Sound scenes.** Build a tavern once -- a music track, a crowd murmur looping underneath, a door
  slam every couple of minutes -- and start the whole thing with one click.
- **One console for live play.** Favourites, now-playing, and transport for everything, without
  opening the playlist sidebar during a session.
- **Cues.** One-shot effects you fire by hand, which can duck the music underneath them so the moment
  lands.
- **Automation.** Rules that start or stop a scene when combat begins, a round turns over, the party
  moves to a new map, or the game world reaches a particular time of day.
- **Menubar transport.** Stop music, environment, one-shots or everything, without opening the window.
- **Your audio stays yours.** Minstrel plays ordinary Foundry playlist sounds. It imports nothing,
  converts nothing, and everything it builds stays visible in the Playlists sidebar.

Minstrel is Gamemaster only. Players hear the audio and see none of the interface.

## Requirements

- **FoundryVTT** version 13.
- **Coffee Pub Blacksmith**, installed and enabled. Minstrel will not run without it.

## Install

Inside Foundry VTT, add this manifest URL:

```
https://github.com/Drowbe/coffee-pub-minstrel/releases/latest/download/module.json
```

Then enable Minstrel in your world's module settings, with Coffee Pub Blacksmith enabled alongside it.

## Where to read more

The [wiki](https://github.com/Drowbe/coffee-pub-minstrel/wiki) has the detail:

- [Getting started](https://github.com/Drowbe/coffee-pub-minstrel/wiki/userguide-getting-started) --
  what changes on screen, the five tabs, and your first five minutes.
- [Architecture](https://github.com/Drowbe/coffee-pub-minstrel/wiki/architecture-minstrel) -- how the
  module is built, for anyone changing it.
- [Known issues](https://github.com/Drowbe/coffee-pub-minstrel/wiki/known-issues).

## The Coffee Pub suite

Minstrel is one of a family of modules for D&D 5e on Foundry. Blacksmith is required by all of them;
the rest are optional and independent.

| Module | What it does |
|---|---|
| [Blacksmith](https://github.com/Drowbe/coffee-pub-blacksmith) | Quality of life, gameplay frameworks, automation, and aesthetic improvements |
| [Squire](https://github.com/Drowbe/coffee-pub-squire) | A character tray: quick access to abilities, items and spells |
| [Crier](https://github.com/Drowbe/coffee-pub-crier) | Combat turn announcements with turn cards and round summaries |
| [Librarian](https://github.com/Drowbe/coffee-pub-librarian) | A campaign codex of people, places, factions and artifacts, and the quests running through them |
| [Scribe](https://github.com/Drowbe/coffee-pub-scribe) | Journal and chat card formatting for sharing narrative |
| [Bibliosoph](https://github.com/Drowbe/coffee-pub-bibliosoph) | In-game player messaging with journal-backed conversations |
| [Curator](https://github.com/Drowbe/coffee-pub-curator) | Image management: token, portrait and map image placement |
| [Merchant](https://github.com/Drowbe/coffee-pub-merchant) | Shops: mark an actor as a merchant and let players browse their stock |
| [Artificer](https://github.com/Drowbe/coffee-pub-artificer) | A crafting, recipe and blueprint system |
| [Cartographer](https://github.com/Drowbe/coffee-pub-cartographer) | Party strategic planning and sketching |
| [Herald](https://github.com/Drowbe/coffee-pub-herald) | A streaming and broadcast view with a designated cameraman user |
| [Monarch](https://github.com/Drowbe/coffee-pub-monarch) | Save and load sets of enabled modules |
| [Regent](https://github.com/Drowbe/coffee-pub-regent) | Optional AI tools and worksheets |
| [Vault](https://github.com/Drowbe/coffee-pub-vault) | Optional assets for the suite |

<!-- global:ai-assistance -->
## AI Assistance and the Illusion of Good Code

I started writing Foundry modules for use at my own table back in 2020. There were already a ton of amazing modules out there, but they either didn't quite do what I wanted or didn't deliver the kind of user experience I was looking for.

I've been a design leader for more than 20 years, but I spent the first half of my career as a developer, so building my own modules seemed like a fun way to kill some time. I'm a pretty good designer. I'm a decent developer. But, over time, my hand-written code and hacks got a little messy (and memory-leaky, and a little buggy. Feels good to say it out loud.).

Today, the Coffee Pub suite of modules is developed with AI assistance, primarily Claude and Cursor, for documentation, refactoring, debugging, and other development work. Every change is reviewed and committed by me, and nothing reaches a release that I haven't crawled and run at my own table. I can't seem to give up my IDE. The UX design, architecture, and ideas still come from my own fever dreams and chronic lack of sleep.

Testing and verifying a change means running it in Foundry so I can watch the console, break things, fix them, and hone the experience. The repositories carry a set of tools for testing the things that are difficult to catch through review and manual testing alone. They help ensure styles don't conflict, shared coding and documentation standards stay consistent, and the suite of modules continues to work well as a system without silently breaking.

Those checks are there because AI-assisted development can move very quickly, and without oversight, engagement, and planning, it can also go confidently off the rails and deliver the illusion of good code. The AI helps me build faster. It doesn't decide what gets built, its architecture, or how it should work. You can blame this human for that.

If the idea of AI-assisted development keeps you up at night or just isn't your jam, no worries at all. I get it. You do you.
<!-- /global:ai-assistance -->

## License

MIT. See [LICENSE](LICENSE).
