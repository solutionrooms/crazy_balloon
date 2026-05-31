#!/usr/bin/env python3
"""A Z80 CPU emulator — complete enough to boot the Crazy Balloon ROM and run
its drawing/interrupt code so we can snapshot VRAM and extract exact mazes.

Design notes:
- 64KB flat memory; writes below ROM_END are ignored (cartridge ROM is r/o).
- I/O via in_port/out_port callbacks (defaults chosen to let boot proceed).
- IM 1 maskable interrupt vectors to 0x0038 (the ROM's VBLANK ISR jumps on).
- Documented-opcode register model: in DD/FD mode (HL)->(IX+d) and the HL pair
  becomes IX/IY; H/L stay real H/L (no undocumented IXH/IXL). Validated against
  the ROM's actual behaviour.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Flag bits
FC, FN, FPV, F3, FH, F5, FZ, FS = 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80

PARITY = [0] * 256
for _i in range(256):
    PARITY[_i] = FPV if bin(_i).count("1") % 2 == 0 else 0


class Z80:
    def __init__(self, mem: bytearray, rom_end: int = 0x3000):
        self.m = mem
        self.rom_end = rom_end
        self.a = self.f = self.b = self.c = self.d = self.e = self.h = self.l = 0
        self.a2 = self.f2 = self.b2 = self.c2 = self.d2 = self.e2 = self.h2 = self.l2 = 0
        self.ix = self.iy = 0
        self.sp = 0xFFFF
        self.pc = 0
        self.i = self.r = 0
        self.iff1 = self.iff2 = 0
        self.im = 0
        self.halted = False
        self.cycles = 0
        self.io_in_default = 0xFF
        self.io_in_map: dict[int, int] = {}
        self.out_log: list[tuple[int, int]] = []
        self.cur_pc = 0
        self.read_watch: tuple[int, int] | None = None  # (lo, hi) inclusive
        self.read_hits: dict[int, int] = {}             # addr -> first PC that read it

    # ---- memory ----
    def rb(self, a):
        a &= 0xFFFF
        rw = self.read_watch
        if rw is not None and rw[0] <= a <= rw[1] and a not in self.read_hits:
            self.read_hits[a] = self.cur_pc
        return self.m[a]
    def wb(self, a, v):
        a &= 0xFFFF
        if a >= self.rom_end:
            self.m[a] = v & 0xFF
    def rw(self, a): return self.rb(a) | (self.rb(a + 1) << 8)
    def ww(self, a, v):
        self.wb(a, v & 0xFF); self.wb(a + 1, (v >> 8) & 0xFF)
    def fetch(self):
        v = self.m[self.pc]; self.pc = (self.pc + 1) & 0xFFFF; return v
    def fetch2(self):
        v = self.rw(self.pc); self.pc = (self.pc + 2) & 0xFFFF; return v

    # ---- 16-bit register pairs ----
    def _get_bc(self): return (self.b << 8) | self.c
    def _get_de(self): return (self.d << 8) | self.e
    def _get_hl(self): return (self.h << 8) | self.l
    def _get_af(self): return (self.a << 8) | self.f
    def _set_bc(self, v): self.b = (v >> 8) & 0xFF; self.c = v & 0xFF
    def _set_de(self, v): self.d = (v >> 8) & 0xFF; self.e = v & 0xFF
    def _set_hl(self, v): self.h = (v >> 8) & 0xFF; self.l = v & 0xFF
    def _set_af(self, v): self.a = (v >> 8) & 0xFF; self.f = v & 0xFF

    # ---- stack ----
    def push(self, v):
        self.sp = (self.sp - 2) & 0xFFFF; self.ww(self.sp, v)
    def pop(self):
        v = self.rw(self.sp); self.sp = (self.sp + 2) & 0xFFFF; return v

    # ---- I/O ----
    def in_port(self, port):
        return self.io_in_map.get(port & 0xFF, self.io_in_default)
    def out_port(self, port, val):
        self.out_log.append((port & 0xFF, val & 0xFF))

    # ---- ALU helpers (set flags) ----
    def _add8(self, v, carry=0):
        a = self.a; r = a + v + carry
        f = 0
        if (r & 0xFF) == 0: f |= FZ
        f |= r & FS
        if ((a & 0xF) + (v & 0xF) + carry) & 0x10: f |= FH
        if (~(a ^ v) & (a ^ r)) & 0x80: f |= FPV
        if r & 0x100: f |= FC
        f |= r & (F3 | F5)
        self.a = r & 0xFF; self.f = f
    def _sub8(self, v, carry=0):
        a = self.a; r = a - v - carry
        f = FN
        if (r & 0xFF) == 0: f |= FZ
        f |= r & FS
        if ((a & 0xF) - (v & 0xF) - carry) & 0x10: f |= FH
        if ((a ^ v) & (a ^ r)) & 0x80: f |= FPV
        if r & 0x100: f |= FC
        f |= r & (F3 | F5)
        self.a = r & 0xFF; self.f = f
    def _cp(self, v):
        a = self.a; r = a - v
        f = FN
        if (r & 0xFF) == 0: f |= FZ
        f |= r & FS
        if ((a & 0xF) - (v & 0xF)) & 0x10: f |= FH
        if ((a ^ v) & (a ^ r)) & 0x80: f |= FPV
        if r & 0x100: f |= FC
        f |= v & (F3 | F5)
        self.f = f
    def _and(self, v):
        self.a &= v; self.f = FH | PARITY[self.a] | (self.a & (FS | F3 | F5))
        if self.a == 0: self.f |= FZ
    def _or(self, v):
        self.a |= v; self.f = PARITY[self.a] | (self.a & (FS | F3 | F5))
        if self.a == 0: self.f |= FZ
    def _xor(self, v):
        self.a ^= v; self.f = PARITY[self.a] | (self.a & (FS | F3 | F5))
        if self.a == 0: self.f |= FZ
    def _inc8(self, v):
        r = (v + 1) & 0xFF
        f = self.f & FC
        f |= r & (FS | F3 | F5)
        if r == 0: f |= FZ
        if (v & 0xF) == 0xF: f |= FH
        if v == 0x7F: f |= FPV
        self.f = f; return r
    def _dec8(self, v):
        r = (v - 1) & 0xFF
        f = (self.f & FC) | FN
        f |= r & (FS | F3 | F5)
        if r == 0: f |= FZ
        if (v & 0xF) == 0: f |= FH
        if v == 0x80: f |= FPV
        self.f = f; return r
    def _add16(self, a, b):
        r = a + b
        f = self.f & (FS | FZ | FPV)
        if ((a & 0xFFF) + (b & 0xFFF)) & 0x1000: f |= FH
        if r & 0x10000: f |= FC
        f |= (r >> 8) & (F3 | F5)
        self.f = f; return r & 0xFFFF
    def _adc16(self, a, b):
        c = self.f & FC; r = a + b + c
        f = 0
        if r & 0x8000: f |= FS
        if (r & 0xFFFF) == 0: f |= FZ
        if ((a & 0xFFF) + (b & 0xFFF) + c) & 0x1000: f |= FH
        if (~(a ^ b) & (a ^ r)) & 0x8000: f |= FPV
        if r & 0x10000: f |= FC
        f |= (r >> 8) & (F3 | F5)
        self.f = f; return r & 0xFFFF
    def _sbc16(self, a, b):
        c = self.f & FC; r = a - b - c
        f = FN
        if r & 0x8000: f |= FS
        if (r & 0xFFFF) == 0: f |= FZ
        if ((a & 0xFFF) - (b & 0xFFF) - c) & 0x1000: f |= FH
        if ((a ^ b) & (a ^ r)) & 0x8000: f |= FPV
        if r & 0x10000: f |= FC
        f |= (r >> 8) & (F3 | F5)
        self.f = f; return r & 0xFFFF

    # ---- rotates/shifts (CB + accumulator) ----
    def _rlc(self, v):
        c = (v >> 7) & 1; r = ((v << 1) | c) & 0xFF; self._szp_c(r, c); return r
    def _rrc(self, v):
        c = v & 1; r = ((v >> 1) | (c << 7)) & 0xFF; self._szp_c(r, c); return r
    def _rl(self, v):
        c = (v >> 7) & 1; r = ((v << 1) | (self.f & FC)) & 0xFF; self._szp_c(r, c); return r
    def _rr(self, v):
        c = v & 1; r = ((v >> 1) | ((self.f & FC) << 7)) & 0xFF; self._szp_c(r, c); return r
    def _sla(self, v):
        c = (v >> 7) & 1; r = (v << 1) & 0xFF; self._szp_c(r, c); return r
    def _sra(self, v):
        c = v & 1; r = ((v >> 1) | (v & 0x80)) & 0xFF; self._szp_c(r, c); return r
    def _sll(self, v):
        c = (v >> 7) & 1; r = ((v << 1) | 1) & 0xFF; self._szp_c(r, c); return r
    def _srl(self, v):
        c = v & 1; r = (v >> 1) & 0xFF; self._szp_c(r, c); return r
    def _szp_c(self, r, c):
        self.f = PARITY[r] | (r & (FS | F3 | F5)) | (FC if c else 0)
        if r == 0: self.f |= FZ

    # ---- register file index 0..7 = B,C,D,E,H,L,(HL),A ----
    def get_r(self, i, idx=None, disp=0):
        if i == 0: return self.b
        if i == 1: return self.c
        if i == 2: return self.d
        if i == 3: return self.e
        if i == 4: return self.h
        if i == 5: return self.l
        if i == 6:
            if idx is None: return self.rb(self._get_hl())
            return self.rb((idx + disp) & 0xFFFF)
        return self.a
    def set_r(self, i, v, idx=None, disp=0):
        v &= 0xFF
        if i == 0: self.b = v
        elif i == 1: self.c = v
        elif i == 2: self.d = v
        elif i == 3: self.e = v
        elif i == 4: self.h = v
        elif i == 5: self.l = v
        elif i == 6:
            if idx is None: self.wb(self._get_hl(), v)
            else: self.wb((idx + disp) & 0xFFFF, v)
        else: self.a = v

    def get_rp(self, p, idx=None):
        if p == 0: return self._get_bc()
        if p == 1: return self._get_de()
        if p == 2: return idx if idx is not None else self._get_hl()
        return self.sp
    def set_rp(self, p, v, idx=None):
        v &= 0xFFFF
        if p == 0: self._set_bc(v)
        elif p == 1: self._set_de(v)
        elif p == 2:
            if idx is not None: return v  # caller assigns ix/iy
            self._set_hl(v)
        else: self.sp = v
        return v

    def cond(self, y):
        return [not (self.f & FZ), self.f & FZ, not (self.f & FC), self.f & FC,
                not (self.f & FPV), self.f & FPV, not (self.f & FS), self.f & FS][y]

    # ---- interrupt ----
    def interrupt(self):
        if not self.iff1:
            return False
        self.halted = False
        self.iff1 = self.iff2 = 0
        self.push(self.pc)
        if self.im == 1:
            self.pc = 0x0038
        elif self.im == 2:
            self.pc = self.rw((self.i << 8) | 0xFF)
        else:
            self.pc = 0x0038
        self.cycles += 13
        return True

    # ---- main step ----
    def step(self):
        if self.halted:
            self.cycles += 4
            return
        self.cur_pc = self.pc
        self.r = (self.r & 0x80) | ((self.r + 1) & 0x7F)
        op = self.fetch()
        idx = None
        if op == 0xDD:
            idx = "ix"; op = self.fetch(); self.r = (self.r & 0x80) | ((self.r + 1) & 0x7F)
        elif op == 0xFD:
            idx = "iy"; op = self.fetch(); self.r = (self.r & 0x80) | ((self.r + 1) & 0x7F)
        idxv = (self.ix if idx == "ix" else self.iy) if idx else None
        self._exec(op, idx, idxv)

    def _idx_disp(self):
        d = self.fetch()
        return d - 256 if d >= 128 else d

    def _exec(self, op, idx, idxv):
        self.cycles += 4
        if op == 0xCB:
            return self._exec_cb(idx, idxv)
        if op == 0xED:
            return self._exec_ed()
        x, y, z = op >> 6, (op >> 3) & 7, op & 7
        p, q = y >> 1, y & 1

        # helper for (HL)/(IX+d) access in this op
        def rsrc(i):
            if i == 6 and idx is not None:
                return self.get_r(6, idxv, self._cur_disp)
            return self.get_r(i)
        def rdst(i, v):
            if i == 6 and idx is not None:
                return self.set_r(6, v, idxv, self._cur_disp)
            return self.set_r(i, v)

        self._cur_disp = 0
        if idx is not None and (
            (x == 0 and z in (4, 5, 6) and y == 6) or
            (x == 1 and (y == 6 or z == 6)) or
            (x == 2 and z == 6)
        ):
            self._cur_disp = self._idx_disp()

        if x == 0:
            if z == 0:
                if y == 0: return
                if y == 1:
                    self.a, self.a2 = self.a2, self.a; self.f, self.f2 = self.f2, self.f; return
                if y == 2:
                    d = self._idx_disp() if False else (self.fetch())
                    d = d - 256 if d >= 128 else d
                    self.b = (self.b - 1) & 0xFF
                    if self.b != 0: self.pc = (self.pc + d) & 0xFFFF
                    return
                if y == 3:
                    d = self.fetch(); d = d - 256 if d >= 128 else d
                    self.pc = (self.pc + d) & 0xFFFF; return
                d = self.fetch(); d = d - 256 if d >= 128 else d
                if self.cond(y - 4): self.pc = (self.pc + d) & 0xFFFF
                return
            if z == 1:
                if q == 0:
                    nn = self.fetch2()
                    if idx is not None and p == 2:
                        if idx == "ix": self.ix = nn
                        else: self.iy = nn
                    else: self.set_rp(p, nn)
                    return
                # ADD HL/IX/IY, rp
                base = idxv if idx is not None else self._get_hl()
                other = self.get_rp(p, idxv if (idx is not None and p == 2) else None)
                res = self._add16(base, other)
                if idx == "ix": self.ix = res
                elif idx == "iy": self.iy = res
                else: self._set_hl(res)
                return
            if z == 2:
                if q == 0:
                    if p == 0: self.wb(self._get_bc(), self.a); return
                    if p == 1: self.wb(self._get_de(), self.a); return
                    nn = self.fetch2()
                    if p == 2: self.ww(nn, idxv if idx is not None else self._get_hl())
                    else: self.wb(nn, self.a)
                    return
                if p == 0: self.a = self.rb(self._get_bc()); return
                if p == 1: self.a = self.rb(self._get_de()); return
                nn = self.fetch2()
                if p == 2:
                    v = self.rw(nn)
                    if idx == "ix": self.ix = v
                    elif idx == "iy": self.iy = v
                    else: self._set_hl(v)
                else: self.a = self.rb(nn)
                return
            if z == 3:
                if q == 0:
                    if idx is not None and p == 2:
                        if idx == "ix": self.ix = (self.ix + 1) & 0xFFFF
                        else: self.iy = (self.iy + 1) & 0xFFFF
                    else: self.set_rp(p, (self.get_rp(p) + 1) & 0xFFFF)
                else:
                    if idx is not None and p == 2:
                        if idx == "ix": self.ix = (self.ix - 1) & 0xFFFF
                        else: self.iy = (self.iy - 1) & 0xFFFF
                    else: self.set_rp(p, (self.get_rp(p) - 1) & 0xFFFF)
                return
            if z == 4:
                rdst(y, self._inc8(rsrc(y))); return
            if z == 5:
                rdst(y, self._dec8(rsrc(y))); return
            if z == 6:
                n = self.fetch(); rdst(y, n); return
            # z == 7 accumulator/flag ops
            if y == 0:  # RLCA
                c = (self.a >> 7) & 1; self.a = ((self.a << 1) | c) & 0xFF
                self.f = (self.f & (FS | FZ | FPV)) | (FC if c else 0) | (self.a & (F3 | F5)); return
            if y == 1:  # RRCA
                c = self.a & 1; self.a = ((self.a >> 1) | (c << 7)) & 0xFF
                self.f = (self.f & (FS | FZ | FPV)) | (FC if c else 0) | (self.a & (F3 | F5)); return
            if y == 2:  # RLA
                c = (self.a >> 7) & 1; self.a = ((self.a << 1) | (self.f & FC)) & 0xFF
                self.f = (self.f & (FS | FZ | FPV)) | (FC if c else 0) | (self.a & (F3 | F5)); return
            if y == 3:  # RRA
                c = self.a & 1; self.a = ((self.a >> 1) | ((self.f & FC) << 7)) & 0xFF
                self.f = (self.f & (FS | FZ | FPV)) | (FC if c else 0) | (self.a & (F3 | F5)); return
            if y == 4:  # DAA
                self._daa(); return
            if y == 5:  # CPL
                self.a ^= 0xFF; self.f |= FH | FN; self.f = (self.f & ~(F3 | F5)) | (self.a & (F3 | F5)); return
            if y == 6:  # SCF
                self.f = (self.f & (FS | FZ | FPV)) | FC | (self.a & (F3 | F5)); return
            # CCF
            c = self.f & FC
            self.f = (self.f & (FS | FZ | FPV)) | (FH if c else 0) | (0 if c else FC) | (self.a & (F3 | F5)); return

        if x == 1:
            if z == 6 and y == 6:
                self.halted = True; self.pc = (self.pc - 1) & 0xFFFF; return
            # LD r,r' — only the (IX+d) side uses index; reg side stays real
            if idx is not None and z == 6:
                self.set_r(y, self.get_r(6, idxv, self._cur_disp)); return
            if idx is not None and y == 6:
                self.set_r(6, self.get_r(z), idxv, self._cur_disp); return
            self.set_r(y, self.get_r(z)); return

        if x == 2:
            v = rsrc(z)
            [self._add8, lambda x: self._add8(x, self.f & FC), self._sub8,
             lambda x: self._sub8(x, self.f & FC), self._and, self._xor,
             self._or, self._cp][y](v)
            return

        # x == 3
        if z == 0:
            if self.cond(y):
                self.pc = self.pop()
            return
        if z == 1:
            if q == 0:
                v = self.pop()
                if idx == "ix": self.ix = v
                elif idx == "iy": self.iy = v
                elif p == 0: self._set_bc(v)
                elif p == 1: self._set_de(v)
                elif p == 2: self._set_hl(v)
                else: self._set_af(v)
                return
            if p == 0: self.pc = self.pop(); return
            if p == 1:
                self.b, self.b2 = self.b2, self.b; self.c, self.c2 = self.c2, self.c
                self.d, self.d2 = self.d2, self.d; self.e, self.e2 = self.e2, self.e
                self.h, self.h2 = self.h2, self.h; self.l, self.l2 = self.l2, self.l
                return
            if p == 2: self.pc = idxv if idx is not None else self._get_hl(); return
            self.sp = idxv if idx is not None else self._get_hl(); return
        if z == 2:
            nn = self.fetch2()
            if self.cond(y): self.pc = nn
            return
        if z == 3:
            if y == 0: self.pc = self.fetch2(); return
            if y == 2:
                n = self.fetch(); self.out_port((self.a << 8) | n, self.a); return
            if y == 3:
                n = self.fetch(); self.a = self.in_port((self.a << 8) | n); return
            if y == 4:  # EX (SP),HL/IX/IY
                t = self.rw(self.sp)
                if idx == "ix": self.ww(self.sp, self.ix); self.ix = t
                elif idx == "iy": self.ww(self.sp, self.iy); self.iy = t
                else: self.ww(self.sp, self._get_hl()); self._set_hl(t)
                return
            if y == 5:  # EX DE,HL
                self.d, self.h = self.h, self.d; self.e, self.l = self.l, self.e; return
            if y == 6: self.iff1 = self.iff2 = 0; return  # DI
            self.iff1 = self.iff2 = 1; return  # EI
        if z == 4:
            nn = self.fetch2()
            if self.cond(y): self.push(self.pc); self.pc = nn
            return
        if z == 5:
            if q == 0:
                if idx == "ix": self.push(self.ix)
                elif idx == "iy": self.push(self.iy)
                elif p == 0: self.push(self._get_bc())
                elif p == 1: self.push(self._get_de())
                elif p == 2: self.push(self._get_hl())
                else: self.push(self._get_af())
                return
            nn = self.fetch2(); self.push(self.pc); self.pc = nn; return
        if z == 6:
            n = self.fetch()
            [self._add8, lambda x: self._add8(x, self.f & FC), self._sub8,
             lambda x: self._sub8(x, self.f & FC), self._and, self._xor,
             self._or, self._cp][y](n)
            return
        # z == 7 RST
        self.push(self.pc); self.pc = y * 8; return

    def _daa(self):
        a = self.a; f = self.f; corr = 0; carry = f & FC
        if (f & FH) or (a & 0xF) > 9: corr |= 0x06
        if carry or a > 0x99: corr |= 0x60; carry = FC
        if f & FN: a = (a - corr) & 0xFF
        else: a = (a + corr) & 0xFF
        nf = (f & FN) | carry | PARITY[a] | (a & (FS | F3 | F5))
        if a == 0: nf |= FZ
        # H flag (approx, rarely used by game logic)
        self.a = a; self.f = nf

    def _exec_cb(self, idx, idxv):
        if idx is not None:
            d = self._idx_disp()
            cb = self.fetch()
            addr = (idxv + d) & 0xFFFF
            v = self.rb(addr)
            x, y, z = cb >> 6, (cb >> 3) & 7, cb & 7
            if x == 0:
                r = [self._rlc, self._rrc, self._rl, self._rr, self._sla, self._sra, self._sll, self._srl][y](v)
                self.wb(addr, r)
                if z != 6: self.set_r(z, r)
                return
            if x == 1:
                self._bit(y, v); return
            if x == 2:
                r = v & ~(1 << y); self.wb(addr, r)
                if z != 6: self.set_r(z, r)
                return
            r = v | (1 << y); self.wb(addr, r)
            if z != 6: self.set_r(z, r)
            return
        cb = self.fetch()
        x, y, z = cb >> 6, (cb >> 3) & 7, cb & 7
        v = self.get_r(z)
        if x == 0:
            self.set_r(z, [self._rlc, self._rrc, self._rl, self._rr,
                           self._sla, self._sra, self._sll, self._srl][y](v))
            return
        if x == 1:
            self._bit(y, v); return
        if x == 2:
            self.set_r(z, v & ~(1 << y)); return
        self.set_r(z, v | (1 << y))

    def _bit(self, n, v):
        bit = v & (1 << n)
        f = (self.f & FC) | FH | PARITY[bit] & 0  # PV set like Z for BIT
        f = (self.f & FC) | FH
        if not bit: f |= FZ | FPV
        f |= bit & FS
        f |= v & (F3 | F5)
        self.f = f

    def _exec_ed(self):
        ed = self.fetch()
        x, y, z = ed >> 6, (ed >> 3) & 7, ed & 7
        p, q = y >> 1, y & 1
        if x == 1:
            if z == 0:  # IN r,(C)
                val = self.in_port(self._get_bc())
                if y != 6: self.set_r(y, val)
                self.f = (self.f & FC) | PARITY[val] | (val & (FS | F3 | F5)) | (FZ if val == 0 else 0)
                return
            if z == 1:  # OUT (C),r
                self.out_port(self._get_bc(), 0 if y == 6 else self.get_r(y)); return
            if z == 2:
                hl = self._get_hl()
                if q == 0: self._set_hl(self._sbc16(hl, self.get_rp(p)))
                else: self._set_hl(self._adc16(hl, self.get_rp(p)))
                return
            if z == 3:
                nn = self.fetch2()
                if q == 0: self.ww(nn, self.get_rp(p))
                else: self.set_rp(p, self.rw(nn))
                return
            if z == 4:  # NEG
                v = self.a; self.a = 0; self._sub8(v); return
            if z == 5:  # RETN/RETI
                self.pc = self.pop(); self.iff1 = self.iff2; return
            if z == 6:  # IM
                self.im = [0, 0, 1, 2, 0, 0, 1, 2][y]; return
            # z == 7 misc
            if y == 0: self.i = self.a; return
            if y == 1: self.r = self.a; return
            if y == 2:
                self.a = self.i
                self.f = (self.f & FC) | (self.a & FS) | (FZ if self.a == 0 else 0) | (FPV if self.iff2 else 0); return
            if y == 3:
                self.a = self.r & 0xFF
                self.f = (self.f & FC) | (self.a & FS) | (FZ if self.a == 0 else 0) | (FPV if self.iff2 else 0); return
            if y == 4:  # RRD
                hl = self.rb(self._get_hl()); a = self.a
                self.wb(self._get_hl(), ((a << 4) | (hl >> 4)) & 0xFF)
                self.a = (a & 0xF0) | (hl & 0x0F)
                self.f = (self.f & FC) | PARITY[self.a] | (self.a & (FS | F3 | F5)) | (FZ if self.a == 0 else 0); return
            if y == 5:  # RLD
                hl = self.rb(self._get_hl()); a = self.a
                self.wb(self._get_hl(), ((hl << 4) | (a & 0x0F)) & 0xFF)
                self.a = (a & 0xF0) | (hl >> 4)
                self.f = (self.f & FC) | PARITY[self.a] | (self.a & (FS | F3 | F5)) | (FZ if self.a == 0 else 0); return
            return
        if x == 2 and z < 4 and y >= 4:
            return self._block(y, z)
        # invalid -> NOP

    def _block(self, y, z):
        # y: 4=I,5=D,6=IR(inc+repeat),7=DR(dec+repeat) ; z:0=LD,1=CP,2=IN,3=OUT
        inc = 1 if y in (4, 6) else -1
        repeat = y in (6, 7)
        if z == 0:  # LDI/LDD/LDIR/LDDR
            v = self.rb(self._get_hl())
            self.wb(self._get_de(), v)
            self._set_hl((self._get_hl() + inc) & 0xFFFF)
            self._set_de((self._get_de() + inc) & 0xFFFF)
            self._set_bc((self._get_bc() - 1) & 0xFFFF)
            self.f &= (FS | FZ | FC)
            if self._get_bc() != 0: self.f |= FPV
            if repeat and self._get_bc() != 0:
                self.pc = (self.pc - 2) & 0xFFFF
            return
        if z == 1:  # CPI/CPD/CPIR/CPDR
            v = self.rb(self._get_hl())
            r = (self.a - v) & 0xFF
            self._set_hl((self._get_hl() + inc) & 0xFFFF)
            self._set_bc((self._get_bc() - 1) & 0xFFFF)
            f = (self.f & FC) | FN
            if r == 0: f |= FZ
            f |= r & FS
            if ((self.a & 0xF) - (v & 0xF)) & 0x10: f |= FH
            if self._get_bc() != 0: f |= FPV
            self.f = f
            if repeat and self._get_bc() != 0 and r != 0:
                self.pc = (self.pc - 2) & 0xFFFF
            return
        if z == 2:  # INI/IND/INIR/INDR
            v = self.in_port(self._get_bc())
            self.wb(self._get_hl(), v)
            self.b = (self.b - 1) & 0xFF
            self._set_hl((self._get_hl() + inc) & 0xFFFF)
            self.f = FN | (FZ if self.b == 0 else 0)
            if repeat and self.b != 0: self.pc = (self.pc - 2) & 0xFFFF
            return
        # z == 3 OUTI/OUTD/OTIR/OTDR
        v = self.rb(self._get_hl())
        self.b = (self.b - 1) & 0xFF
        self.out_port(self._get_bc(), v)
        self._set_hl((self._get_hl() + inc) & 0xFFFF)
        self.f = FN | (FZ if self.b == 0 else 0)
        if repeat and self.b != 0: self.pc = (self.pc - 2) & 0xFFFF


def load_machine() -> Z80:
    mem = bytearray(0x10000)
    base = 0
    for i in range(1, 7):
        data = (ROOT / "rom" / f"cl0{i}.bin").read_bytes()
        mem[base:base + len(data)] = data
        base += len(data)
    return Z80(mem)


if __name__ == "__main__":
    # smoke test: boot a few thousand instructions, ensure PC stays sane
    cpu = load_machine()
    for _ in range(20000):
        cpu.step()
    print(f"after 20k steps: PC={cpu.pc:04X} SP={cpu.sp:04X} "
          f"A={cpu.a:02X} HL={cpu._get_hl():04X} cycles={cpu.cycles}")
    print(f"OUT ports touched: {sorted(set(p for p, _ in cpu.out_log))}")
