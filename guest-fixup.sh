#!/bin/bash
# Fix rc.xml (XML quoting), deploy meta-tap launcher, layer python3-evdev.
set -eu

sudo rpm-ostree install --idempotent python3-evdev || true

ODY=$(ls ~/AppImages/*.appimage ~/AppImages/*.AppImage 2>/dev/null | head -1)

# Corrected rc.xml: &quot; for nested quotes (XML has no backslash escapes)
sed -e 's|\\"\$(slurp)\\"|\&quot;$(slurp)\&quot;|' ~/.config/labwc/rc.xml > /tmp/rc-check.xml || true
cat > ~/.config/labwc/rc.xml <<EOF
<?xml version="1.0"?>
<labwc_config>
  <theme>
    <name>PureBlack</name>
    <font name="Inter Variable" size="10"/>
  </theme>
  <desktops number="9">
    <names>
      <name>left top</name><name>top</name><name>right top</name>
      <name>left</name><name>middle</name><name>right</name>
      <name>left bottom</name><name>bottom</name><name>right bottom</name>
    </names>
  </desktops>
  <windowRules>
    <windowRule identifier="*" serverDecoration="no"/>
  </windowRules>
  <keyboard>
    <default/>
    <keybind key="W-C-Left"><action name="GoToDesktop" to="left"/></keybind>
    <keybind key="W-C-Right"><action name="GoToDesktop" to="right"/></keybind>
    <keybind key="W-C-Up"><action name="GoToDesktop" to="left"/><action name="GoToDesktop" to="left"/><action name="GoToDesktop" to="left"/></keybind>
    <keybind key="W-C-Down"><action name="GoToDesktop" to="right"/><action name="GoToDesktop" to="right"/><action name="GoToDesktop" to="right"/></keybind>
    <keybind key="W-C-S-Left"><action name="SendToDesktop" to="left"/></keybind>
    <keybind key="W-C-S-Right"><action name="SendToDesktop" to="right"/></keybind>
    <keybind key="W-C-S-Up"><action name="SendToDesktop" to="left"/><action name="SendToDesktop" to="left"/><action name="SendToDesktop" to="left"/></keybind>
    <keybind key="W-C-S-Down"><action name="SendToDesktop" to="right"/><action name="SendToDesktop" to="right"/><action name="SendToDesktop" to="right"/></keybind>
    <keybind key="C-F1"><action name="GoToDesktop" to="1"/></keybind>
    <keybind key="C-F2"><action name="GoToDesktop" to="2"/></keybind>
    <keybind key="C-F3"><action name="GoToDesktop" to="3"/></keybind>
    <keybind key="C-F4"><action name="GoToDesktop" to="4"/></keybind>
    <keybind key="W-F1"><action name="GoToDesktop" to="1"/></keybind>
    <keybind key="W-F2"><action name="GoToDesktop" to="2"/></keybind>
    <keybind key="W-F3"><action name="GoToDesktop" to="3"/></keybind>
    <keybind key="W-F4"><action name="GoToDesktop" to="4"/></keybind>
    <keybind key="W-Up"><action name="ToggleMaximize"/></keybind>
    <keybind key="W-Down"><action name="Iconify"/></keybind>
    <keybind key="W-Left"><action name="SnapToEdge" direction="left"/></keybind>
    <keybind key="W-Right"><action name="SnapToEdge" direction="right"/></keybind>
    <keybind key="W-S-Left"><action name="MoveToOutput" direction="left"/></keybind>
    <keybind key="W-S-Right"><action name="MoveToOutput" direction="right"/></keybind>
    <keybind key="A-F3"><action name="ShowMenu" menu="client-menu"/></keybind>
    <keybind key="A-F4"><action name="Close"/></keybind>
    <keybind key="W-Tab"><action name="NextWindow"/></keybind>
    <keybind key="A-F1"><action name="Execute" command="fuzzel"/></keybind>
    <keybind key="F13"><action name="Execute" command="fuzzel"/></keybind>
    <keybind key="W-Return"><action name="Execute" command="uwsm app -- $ODY"/></keybind>
    <keybind key="W-L"><action name="Execute" command="swaylock -f"/></keybind>
    <keybind key="W-V"><action name="Execute" command="sh -c 'cliphist list | fuzzel --dmenu | cliphist decode | wl-copy'"/></keybind>
    <keybind key="Print"><action name="Execute" command="sh -c 'grim - | tee ~/Pictures/screenshot-\$(date +%s).png | wl-copy'"/></keybind>
    <keybind key="W-S-S"><action name="Execute" command="sh -c 'grim -g &quot;\$(slurp)&quot; - | swappy -f -'"/></keybind>
  </keyboard>
</labwc_config>
EOF
python3 -c 'import xml.etree.ElementTree as ET; ET.parse("'"$HOME"'/.config/labwc/rc.xml")' && echo XML_VALID

mkdir -p ~/.local/bin
cp ~/meta-tap-launcher.py ~/.local/bin/meta-tap-launcher
chmod +x ~/.local/bin/meta-tap-launcher
grep -q meta-tap-launcher ~/.config/labwc/autostart || \
  echo 'uwsm app -- ~/.local/bin/meta-tap-launcher >/dev/null 2>&1 &' >> ~/.config/labwc/autostart

echo FIXUP_OK
