#!/usr/bin/env python3
"""
Inject text into a terminal's input buffer using TIOCSTI.
This simulates keyboard input to the terminal.

Usage: inject-input.py <tty_path> <text>
"""

import sys
import fcntl
import termios

def inject_input(tty_path, text):
    """Inject text into the terminal's input buffer."""
    try:
        with open(tty_path, 'w') as tty:
            for char in text:
                # TIOCSTI = 0x5412 on Linux, different on macOS
                # macOS: TIOCSTI = 0x80017472
                import platform
                if platform.system() == 'Darwin':
                    TIOCSTI = 0x80017472
                else:
                    TIOCSTI = 0x5412
                fcntl.ioctl(tty.fileno(), TIOCSTI, char.encode())
        return True
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return False

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: inject-input.py <tty_path> <text>", file=sys.stderr)
        sys.exit(1)

    tty_path = sys.argv[1]
    text = sys.argv[2]

    # Add newline to simulate Enter key
    if not text.endswith('\n'):
        text += '\n'

    success = inject_input(tty_path, text)
    sys.exit(0 if success else 1)
