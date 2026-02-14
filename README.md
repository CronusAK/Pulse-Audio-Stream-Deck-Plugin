# PipeWire Audio Control for OpenDeck

A Stream Deck plugin for controlling PipeWire audio on Linux via [OpenDeck](https://github.com/ninjadev64/OpenDeck).

## Features

- **Master Volume** -- Increase, decrease, and mute system audio
- **Microphone Control** -- Increase, decrease, and mute the default mic input
- **Per-App Audio** -- Control volume and mute for individual applications
- **Output Device Control** -- Select a specific output sink and control its volume/mute independently
- **Input Device Control** -- Select a specific input source and control its volume/mute independently
- **Device Switching** -- Assign a button to any output or input device; press to set it as the system default. Active device shows a green bar, inactive shows grey.
- **Configurable Volume Step** -- Per-action slider (1--20%) controls how much each button press or dial tick changes volume
- **Encoder Support** -- Dial rotation for volume adjustment (step multiplied by ticks), press/touch to toggle mute or switch default device
- **Real-time Feedback** -- Live volume bars and device names on button/encoder screens, updated automatically when PipeWire state changes

## Requirements

- Linux with [PipeWire](https://pipewire.org/) and [WirePlumber](https://pipewire.pages.freedesktop.org/wireplumber/)
- [OpenDeck](https://github.com/ninjadev64/OpenDeck) >= 6.0
- Node.js
- System tools: `wpctl`, `pactl`, `pw-dump`

## Building

```bash
./build.sh
```

This bumps the patch version, installs dependencies, and produces `builds/com.sfgrimes.pipewire-audio.streamDeckPlugin`, which can be installed through OpenDeck.

## Actions

| Action | Description |
|--------|-------------|
| Volume Up / Down | Adjust master output volume |
| Mute Toggle | Toggle master output mute |
| Mic Up / Down | Adjust default microphone volume |
| Mic Mute | Toggle default microphone mute |
| App Volume Up / Down | Adjust a specific app's volume |
| App Mute | Toggle a specific app's mute state |
| Output Volume Up / Down | Adjust a specific output device's volume |
| Output Mute | Toggle a specific output device's mute state |
| Input Volume Up / Down | Adjust a specific input device's volume |
| Input Mute | Toggle a specific input device's mute state |
| Switch Output Device | Set a specific output device as the system default |
| Switch Input Device | Set a specific input device as the system default |

All actions support both keypad (button) and encoder (dial) controllers. The volume step size is configurable per action from the property inspector.

## Setting Up Virtual Sinks

Virtual sinks are useful for routing audio from specific applications to different outputs. For example, you can send game audio to your headphones and music to your speakers, then control each independently with the Output Volume actions.

### Create a virtual sink

Add the following to `~/.config/pipewire/pipewire.conf.d/virtual-sinks.conf` (create the directory if it does not exist):

```
context.objects = [
    {
        factory = adapter
        args = {
            factory.name = support.null-audio-sink
            node.name = "virtual-music"
            node.description = "Music"
            media.class = "Audio/Sink"
            audio.position = [ FL FR ]
        }
    }
    {
        factory = adapter
        args = {
            factory.name = support.null-audio-sink
            node.name = "virtual-games"
            node.description = "Games"
            media.class = "Audio/Sink"
            audio.position = [ FL FR ]
        }
    }
]
```

Each block creates one virtual sink. Adjust the `node.name` (internal identifier) and `node.description` (display name) as needed. Add or remove blocks for as many sinks as you want.

### Apply changes

Restart PipeWire to load the new configuration:

```bash
systemctl --user restart pipewire pipewire-pulse wireplumber
```

### Verify the sinks exist

```bash
wpctl status
```

The virtual sinks should appear under "Audio > Sinks". You can also confirm with:

```bash
pw-dump | grep -A2 '"node.name"' | grep virtual
```

### Route applications to virtual sinks

Use `pavucontrol`, `pwvucontrol`, or your desktop environment's sound settings to assign applications to the desired virtual sink. Once an application is routed to a virtual sink, you can use the **Output Volume** actions in this plugin to control that sink's volume from your Stream Deck.

### Use with the plugin

1. Add an **Output Volume Up**, **Output Volume Down**, or **Output Mute** action to your Stream Deck.
2. Open the action's property inspector and select the virtual sink from the device dropdown.
3. The button/dial will now control that specific sink's volume and mute state.

You can also use **Switch Output Device** actions to quickly change your system default between physical and virtual sinks.

## License

GNU General Public License v3.0 -- see [LICENSE](LICENSE) for details.
