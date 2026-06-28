import { useEffect, useRef, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { rdpInput } from "../../lib/tauri";
import { WifiOff, MousePointer2 } from "lucide-react";

interface RdpFrameEvent {
  x: number;
  y: number;
  w: number;
  h: number;
  data: string; // base64 RGBA
}

interface RdpSessionProps {
  sessionId: string;
  width?: number;
  height?: number;
}

type ConnState = "connecting" | "active" | "disconnected";

export default function RdpSession({
  sessionId,
  width = 1280,
  height = 800,
}: RdpSessionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasFirstFrame = useRef(false);

  const [connState, setConnState] = useState<ConnState>("connecting");
  const [rdpError, setRdpError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  // Auto-focus the container on mount so keyboard input works immediately
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Listen to session lifecycle events from the Rust backend.
  // Payload is one of: "connected" | "disconnected" | "error:<message>"
  useEffect(() => {
    const statusEvent = `session:status:${sessionId}`;
    const unlisten = listen<string>(statusEvent, (event) => {
      const s = event.payload;
      if (s === "connected") {
        // Backend finished NLA/CredSSP; wait for first frame to show the desktop
      } else if (s.startsWith("error:")) {
        setRdpError(s.slice(6));
        setConnState("disconnected");
      } else {
        // "disconnected" — normal session end
        setConnState("disconnected");
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [sessionId]);

  // Render incoming frame updates onto the canvas
  useEffect(() => {
    const eventName = `rdp:frame:${sessionId}`;
    const unlisten = listen<RdpFrameEvent>(eventName, (event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { x, y, w, h, data } = event.payload;
      const binStr = atob(data);
      const bytes = new Uint8ClampedArray(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }

      ctx.putImageData(new ImageData(bytes, w, h), x, y);

      // Dismiss connecting overlay on first real frame
      if (!hasFirstFrame.current) {
        hasFirstFrame.current = true;
        setConnState("active");
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [sessionId]);

  // Paste local clipboard text into the RDP session character-by-character using
  // TS_FP_UNICODE_KEYBOARD_EVENT (MS-RDPBCGR §2.2.8.1.2.2.2).
  //
  // Layout per character (5 bytes):
  //   byte 0: fpInputHeader = 0x04 (FastPath, 1 event)
  //   byte 1: length = 5
  //   byte 2: eventHeader = FASTPATH_INPUT_EVENT_UNICODE(0x04)<<5 = 0x80, |0x01 for release
  //   bytes 3-4: Unicode code point (LE)
  const pasteClipboard = useCallback(async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (_) {
      return; // clipboard read denied (focus lost, permission, etc.)
    }
    for (const char of text) {
      const cp = char.codePointAt(0);
      if (!cp) continue;
      const mkPdu = (release: boolean) => {
        const pdu = new Uint8Array(5);
        const v = new DataView(pdu.buffer);
        v.setUint8(0, 0x04);               // fpInputHeader
        v.setUint8(1, 0x05);               // length = 5
        v.setUint8(2, release ? 0x81 : 0x80); // eventHeader (0x80 = Unicode, 0x81 = Unicode+Release)
        v.setUint16(3, cp, true);          // unicodeCode LE
        return btoa(String.fromCharCode(...pdu));
      };
      try {
        await rdpInput({ session_id: sessionId, data_base64: mkPdu(false) });
        await rdpInput({ session_id: sessionId, data_base64: mkPdu(true) });
      } catch (_) { break; }
    }
  }, [sessionId]);

  // Build and send a correct RDP FastPath keyboard PDU (TS_FP_KEYBOARD_EVENT).
  //
  // TS_FP_INPUT_PDU layout (MS-RDPBCGR §2.2.8.1.2):
  //   byte 0: fpInputHeader = action(bits 1-0=0) | numEvents(bits 5-2=1<<2) | secFlags(bits 7-6=0) = 0x04
  //   byte 1: length = total PDU size = 4
  //   byte 2: eventHeader = eventCode(bits 7-5=0x00 for scancode) | eventFlags(bits 4-0)
  //             KBDFLAGS_RELEASE=0x01, KBDFLAGS_EXTENDED=0x02
  //   byte 3: keyCode (1-byte scan code)
  const sendKey = useCallback(
    async (code: string, pressed: boolean) => {
      const { scancode, extended } = keyInfo(code);
      if (scancode === 0) return;

      const releaseFlag = pressed ? 0x00 : 0x01; // FASTPATH_INPUT_KBDFLAGS_RELEASE
      const extFlag     = extended ? 0x02 : 0x00; // FASTPATH_INPUT_KBDFLAGS_EXTENDED
      const eventFlags  = releaseFlag | extFlag;

      const pdu = new Uint8Array([
        0x04,       // fpInputHeader: FastPath action + 1 event
        0x04,       // length = 4 bytes total
        eventFlags, // eventHeader: eventCode=0x00 (scancode), eventFlags
        scancode,   // keyCode
      ]);
      const b64 = btoa(String.fromCharCode(...pdu));
      try { await rdpInput({ session_id: sessionId, data_base64: b64 }); } catch (_) {}
    },
    [sessionId]
  );

  // Build and send a correct RDP FastPath pointer PDU (TS_FP_POINTER_EVENT).
  //
  // TS_FP_INPUT_PDU + TS_FP_POINTER_EVENT layout (MS-RDPBCGR §2.2.8.1.2.2.3):
  //   byte 0: fpInputHeader = 0x04
  //   byte 1: length = 9 bytes total
  //   byte 2: eventHeader = eventCode(bits 7-5=0x01 for mouse, → 0x20) | eventFlags(bits 4-0=0)
  //   bytes 3-4: pointerFlags (LE) — PTRFLAGS_MOVE=0x0800, PTRFLAGS_DOWN=0x8000,
  //              BUTTON1=0x1000, BUTTON2=0x2000, BUTTON3=0x4000,
  //              WHEEL=0x0200, WHEEL_NEGATIVE=0x0100
  //   bytes 5-6: xPos (LE)
  //   bytes 7-8: yPos (LE)
  const sendMouse = useCallback(
    async (x: number, y: number, pointerFlags: number) => {
      const pdu = new Uint8Array(9);
      const v   = new DataView(pdu.buffer);
      v.setUint8(0, 0x04);                // fpInputHeader: FastPath + 1 event
      v.setUint8(1, 0x09);                // length = 9 bytes total
      v.setUint8(2, 0x20);                // eventHeader: FASTPATH_INPUT_EVENT_MOUSE (0x01<<5)
      v.setUint16(3, pointerFlags, true); // pointerFlags LE
      v.setUint16(5, x, true);            // xPos LE
      v.setUint16(7, y, true);            // yPos LE
      const b64 = btoa(String.fromCharCode(...pdu));
      try { await rdpInput({ session_id: sessionId, data_base64: b64 }); } catch (_) {}
    },
    [sessionId]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    e.preventDefault();
    // Ctrl+V / Cmd+V → paste local clipboard into the RDP session via Unicode events.
    // All other keys pass through as normal scancode events.
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      pasteClipboard();
      return;
    }
    sendKey(e.code, true);
  }

  function handleKeyUp(e: React.KeyboardEvent) {
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.key === "v") return; // consumed by paste
    sendKey(e.code, false);
  }

  // Accept any event with clientX/clientY so both MouseEvent and WheelEvent work.
  function scaledCoords(e: { clientX: number; clientY: number }): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    return [
      Math.round((e.clientX - rect.left) * (width / rect.width)),
      Math.round((e.clientY - rect.top) * (height / rect.height)),
    ];
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const [x, y] = scaledCoords(e);
    sendMouse(x, y, 0x0800 /* PTRFLAGS_MOVE */);
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    containerRef.current?.focus();
    const [x, y] = scaledCoords(e);
    const btn = e.button === 0 ? 0x1000 : e.button === 2 ? 0x2000 : 0x4000;
    sendMouse(x, y, btn | 0x8000 /* PTRFLAGS_DOWN */);
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const [x, y] = scaledCoords(e);
    const btn = e.button === 0 ? 0x1000 : e.button === 2 ? 0x2000 : 0x4000;
    sendMouse(x, y, btn);
  }

  // Mouse wheel: PTRFLAGS_WHEEL (0x0200) + optional PTRFLAGS_WHEEL_NEGATIVE (0x0100).
  // Rotation amount occupies bits 7-0 (0-255); 120 = one standard Windows wheel notch.
  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const [x, y] = scaledCoords(e);
    const negative = e.deltaY > 0; // positive deltaY = scroll down = "negative" in RDP
    const flags = 0x0200 | (negative ? 0x0100 : 0x0000) | 120;
    sendMouse(x, y, flags);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  const isOverlayVisible = connState !== "active";

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden bg-black flex items-center justify-center w-full h-full relative outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="max-w-full max-h-full object-contain cursor-default"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        style={{ display: "block", imageRendering: "pixelated" }}
      />

      {/* Connecting overlay */}
      {connState === "connecting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-900/95 gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-surface-600 border-t-accent animate-spin" />
          <div className="text-center">
            <p className="text-sm font-medium text-gray-200">Connecting to RDP session</p>
            <p className="text-xs text-muted mt-1">Establishing TLS and authenticating…</p>
          </div>
        </div>
      )}

      {/* Disconnected / error overlay */}
      {connState === "disconnected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-900/95 gap-4 px-8">
          <div className="w-12 h-12 rounded-full bg-red-900/30 border border-red-800/50 flex items-center justify-center flex-shrink-0">
            <WifiOff className="w-6 h-6 text-red-400" />
          </div>
          <div className="text-center max-w-lg">
            <p className="text-sm font-medium text-gray-200">
              {rdpError ? "RDP connection failed" : "Session disconnected"}
            </p>
            {rdpError ? (
              <pre className="mt-2 text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-3 text-left whitespace-pre-wrap break-words">
                {rdpError}
              </pre>
            ) : (
              <p className="text-xs text-muted mt-1">
                Close this tab and reconnect to start a new session.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Click-to-focus hint — shown only when session is active but focus is elsewhere */}
      {!isOverlayVisible && !focused && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 border border-surface-600/50 text-xs text-gray-400 pointer-events-none select-none backdrop-blur-sm">
          <MousePointer2 className="w-3 h-3" />
          Click to capture keyboard &amp; mouse
        </div>
      )}

      {/* Keyboard focus ring */}
      {focused && !isOverlayVisible && (
        <div className="absolute inset-0 pointer-events-none ring-1 ring-accent/30 ring-inset" />
      )}
    </div>
  );
}

// ── Key info lookup ───────────────────────────────────────────────────────────
//
// Returns the RDP scan code and whether the FASTPATH_INPUT_KBDFLAGS_EXTENDED (0x02)
// flag must be set. Extended keys share a scancode with a regular key but are
// distinguished by the E0 prefix on the wire — in FastPath the flag replaces E0.

interface KeyData { scancode: number; extended: boolean; }

function keyInfo(code: string): KeyData {
  // Extended keys: right-side modifiers, navigation cluster, numpad operators.
  // These use the same base scancode as their left/main counterpart but need
  // FASTPATH_INPUT_KBDFLAGS_EXTENDED (0x02) set in the eventHeader.
  const extendedKeys: Record<string, number> = {
    ControlRight: 0x1d,   // same scancode as ControlLeft
    AltRight:     0x38,   // same scancode as AltLeft
    Home:         0x47,
    ArrowUp:      0x48,
    PageUp:       0x49,
    ArrowLeft:    0x4b,
    ArrowRight:   0x4d,
    End:          0x4f,
    ArrowDown:    0x50,
    PageDown:     0x51,
    Insert:       0x52,
    Delete:       0x53,
    NumpadEnter:  0x1c,   // same scancode as Enter
    NumpadDivide: 0x35,   // same scancode as Slash
    MetaLeft:     0x5b,
    MetaRight:    0x5c,
    ContextMenu:  0x5d,
  };

  if (code in extendedKeys) {
    return { scancode: extendedKeys[code], extended: true };
  }

  const regularKeys: Record<string, number> = {
    Escape:           0x01,
    Digit1:           0x02, Digit2:      0x03, Digit3:    0x04, Digit4:    0x05,
    Digit5:           0x06, Digit6:      0x07, Digit7:    0x08, Digit8:    0x09,
    Digit9:           0x0a, Digit0:      0x0b,
    Minus:            0x0c, Equal:       0x0d,
    Backspace:        0x0e,
    Tab:              0x0f,
    KeyQ:             0x10, KeyW:        0x11, KeyE:      0x12, KeyR:      0x13,
    KeyT:             0x14, KeyY:        0x15, KeyU:      0x16, KeyI:      0x17,
    KeyO:             0x18, KeyP:        0x19,
    BracketLeft:      0x1a, BracketRight: 0x1b,
    Enter:            0x1c,
    ControlLeft:      0x1d,
    KeyA:             0x1e, KeyS:        0x1f, KeyD:      0x20, KeyF:      0x21,
    KeyG:             0x22, KeyH:        0x23, KeyJ:      0x24, KeyK:      0x25,
    KeyL:             0x26,
    Semicolon:        0x27, Quote:       0x28,
    Backquote:        0x29,
    ShiftLeft:        0x2a,
    Backslash:        0x2b,
    KeyZ:             0x2c, KeyX:        0x2d, KeyC:      0x2e, KeyV:      0x2f,
    KeyB:             0x30, KeyN:        0x31, KeyM:      0x32,
    Comma:            0x33, Period:      0x34, Slash:     0x35,
    ShiftRight:       0x36,
    NumpadMultiply:   0x37,
    AltLeft:          0x38,
    Space:            0x39,
    CapsLock:         0x3a,
    F1:  0x3b, F2:  0x3c, F3:  0x3d, F4:  0x3e, F5:  0x3f,
    F6:  0x40, F7:  0x41, F8:  0x42, F9:  0x43, F10: 0x44,
    NumLock:          0x45,
    ScrollLock:       0x46,
    Numpad7:          0x47, Numpad8:     0x48, Numpad9:  0x49,
    NumpadSubtract:   0x4a,
    Numpad4:          0x4b, Numpad5:     0x4c, Numpad6:  0x4d,
    NumpadAdd:        0x4e,
    Numpad1:          0x4f, Numpad2:     0x50, Numpad3:  0x51,
    Numpad0:          0x52, NumpadDecimal: 0x53,
    IntlBackslash:    0x56,
    F11:              0x57, F12:         0x58,
  };

  return { scancode: regularKeys[code] ?? 0, extended: false };
}
