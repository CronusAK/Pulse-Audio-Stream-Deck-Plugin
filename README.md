# PipeWire Audio Control for OpenDeck

A Stream Deck plugin for controlling PipeWire audio on Linux via [OpenDeck](https://github.com/ninjadev64/OpenDeck).

## Features

- **Master Volume** -- Increase, decrease, and mute system audio
- **Microphone Control** -- Increase, decrease, and mute the default mic input
- **Per-App Audio** -- Control volume and mute for individual applications
- **Output Device Control** -- Select a specific output sink and control its volume/mute independently
- **Input Device Control** -- Select a specific input source and control its volume/mute independently
- **Device Switching** -- Assign a button to any output or input device; press to set it as the system default. Active device shows a green bar, inactive shows grey.
- **Push-to-Talk** -- Hold to unmute your microphone; mic mutes automatically on release. Mic will auto-mute after 5 seconds as a safety fallback if the button release is missed.
- **Configurable Volume Step** -- Per-action slider (1--20%) controls how much each button press or dial tick changes volume
- **Encoder Support** -- Dial rotation for volume adjustment (step multiplied by ticks), press/touch to toggle mute or switch default device
- **Real-time Feedback** -- Live volume bars and device names on button/encoder screens, updated automatically when PipeWire state changes
- **Display Options** -- Per-action background color, toggleable device name, volume bar, and percentage overlay; text and icons include a black outline for readability on any background color

## Requirements

- Linux with [PipeWire](https://pipewire.org/) and [WirePlumber](https://pipewire.pages.freedesktop.org/wireplumber/)
- [OpenDeck](https://github.com/ninjadev64/OpenDeck) >= 2.0
- Node.js
- System tools: `wpctl`, `pactl`, `pw-dump`

## Building

```bash
./build.sh
```

This installs dependencies and produces `builds/com.sfgrimes.pipewire-audio.streamDeckPlugin`, which can be installed through OpenDeck.

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
| Push-to-Talk | Hold to unmute mic, releases on button up; Configurable auto-mutes after X seconds as a safety fallback |

All volume and mute actions support both keypad (button) and encoder (dial) controllers. Push-to-Talk is keypad only. The volume step size is configurable per action from the property inspector.

## Setting Up Virtual Sinks

Virtual sinks are useful for routing audio from specific applications to different outputs. For example, you can send game audio to your headphones and music to your speakers, then control each independently with the Output Volume actions.

### Create the sink script

Create `~/.config/pipewire/systemd/sinks.sh` (and the directory if it does not exist):

```bash
#!/usr/bin/env bash

sinks=("Chat" "Browser" "Game" "Media" "System")

for sink in "${sinks[@]}"; do
    pactl load-module module-null-sink \
        sink_name="$sink" \
        sink_properties="device.description=$sink"
done
```

Edit the `sinks` array to add, remove, or rename sinks as needed. Make the script executable:

```bash
chmod +x ~/.config/pipewire/systemd/sinks.sh
```

### Create a systemd user service

Create `~/.config/systemd/user/pipewire-sinks.service`:

```ini
[Unit]
Description=Create custom PipeWire null sinks
After=pipewire.service wireplumber.service
Requires=pipewire.service

[Service]
Type=oneshot
ExecStart=%h/.config/pipewire/systemd/sinks.sh
RemainAfterExit=true

[Install]
WantedBy=default.target
```

### Enable and start the service

```bash
systemctl --user daemon-reload
systemctl --user enable --now pipewire-sinks.service
```

The sinks will now be created automatically on login.

### Verify the sinks exist

```bash
wpctl status
```

The virtual sinks should appear under "Audio > Sinks". You can also confirm with:

```bash
pactl list sinks short
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
