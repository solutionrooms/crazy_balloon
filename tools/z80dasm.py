#!/usr/bin/env python3
"""Compact, complete Z80 disassembler using algorithmic (x/y/z) opcode decoding.

Covers unprefixed + CB + ED + DD/FD (+ DDCB/FDCB) instruction sets. Good enough
to read the Crazy Balloon maze-draw routine and to cross-check the emulator.

  python3 tools/z80dasm.py 0x2700 0x60        # disassemble 0x60 bytes from 0x2700
  python3 tools/z80dasm.py --find 0x2860      # find LD rp,nn / refs to an address
"""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

R = ["B", "C", "D", "E", "H", "L", "(HL)", "A"]
RP = ["BC", "DE", "HL", "SP"]
RP2 = ["BC", "DE", "HL", "AF"]
CC = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"]
ALU = ["ADD A,", "ADC A,", "SUB ", "SBC A,", "AND ", "XOR ", "OR ", "CP "]
ROT = ["RLC", "RRC", "RL", "RR", "SLA", "SRA", "SLL", "SRL"]
IM = ["0", "0", "1", "2", "0", "0", "1", "2"]


def load_prog() -> bytes:
    d = bytearray()
    for i in range(1, 7):
        d += (ROOT / "rom" / f"cl0{i}.bin").read_bytes()
    return bytes(d)


def s8(b: int) -> int:
    return b - 256 if b >= 128 else b


def disasm_one(mem: bytes, pc: int) -> tuple[str, int]:
    start = pc
    op = mem[pc]; pc += 1
    idx = None  # IX/IY substitution
    if op in (0xDD, 0xFD):
        idx = "IX" if op == 0xDD else "IY"
        op = mem[pc]; pc += 1

    def reg(i):
        if idx and i == 6:
            d = s8(mem[pc]);
            return f"({idx}{d:+d})"
        if idx and i == 4:
            return idx + "H"
        if idx and i == 5:
            return idx + "L"
        return R[i]

    def hl():
        return idx if idx else "HL"

    if op == 0xCB:
        if idx:
            d = s8(mem[pc]); pc += 1
            cb = mem[pc]; pc += 1
            x, y, z = cb >> 6, (cb >> 3) & 7, cb & 7
            tgt = f"({idx}{d:+d})"
            if x == 0:
                return f"{ROT[y]} {tgt}", pc - start
            if x == 1:
                return f"BIT {y},{tgt}", pc - start
            if x == 2:
                return f"RES {y},{tgt}", pc - start
            return f"SET {y},{tgt}", pc - start
        cb = mem[pc]; pc += 1
        x, y, z = cb >> 6, (cb >> 3) & 7, cb & 7
        if x == 0:
            return f"{ROT[y]} {R[z]}", pc - start
        if x == 1:
            return f"BIT {y},{R[z]}", pc - start
        if x == 2:
            return f"RES {y},{R[z]}", pc - start
        return f"SET {y},{R[z]}", pc - start

    if op == 0xED:
        ed = mem[pc]; pc += 1
        x, y, z = ed >> 6, (ed >> 3) & 7, ed & 7
        p, q = y >> 1, y & 1
        if x == 1:
            if z == 0:
                return ("IN (C)" if y == 6 else f"IN {R[y]},(C)"), pc - start
            if z == 1:
                return ("OUT (C),0" if y == 6 else f"OUT (C),{R[y]}"), pc - start
            if z == 2:
                return (f"{'SBC' if q == 0 else 'ADC'} HL,{RP[p]}"), pc - start
            if z == 3:
                nn = mem[pc] | (mem[pc + 1] << 8); pc += 2
                return (f"LD (${nn:04X}),{RP[p]}" if q == 0 else f"LD {RP[p]},(${nn:04X})"), pc - start
            if z == 4:
                return "NEG", pc - start
            if z == 5:
                return ("RETI" if y == 1 else "RETN"), pc - start
            if z == 6:
                return f"IM {IM[y]}", pc - start
            misc = {0: "LD I,A", 1: "LD R,A", 2: "LD A,I", 3: "LD A,R", 4: "RRD", 5: "RLD", 6: "NOP", 7: "NOP"}
            return misc[y], pc - start
        if x == 2 and z < 4 and y >= 4:
            bli = [["LDI", "CPI", "INI", "OUTI"], ["LDD", "CPD", "IND", "OUTD"],
                   ["LDIR", "CPIR", "INIR", "OTIR"], ["LDDR", "CPDR", "INDR", "OTDR"]]
            return bli[y - 4][z], pc - start
        return "NOP*", pc - start

    x, y, z = op >> 6, (op >> 3) & 7, op & 7
    p, q = y >> 1, y & 1

    if x == 0:
        if z == 0:
            if y == 0: return "NOP", pc - start
            if y == 1: return "EX AF,AF'", pc - start
            if y == 2:
                d = s8(mem[pc]); pc += 1
                return f"DJNZ ${start + 2 + d:04X}", pc - start
            if y == 3:
                d = s8(mem[pc]); pc += 1
                return f"JR ${start + 2 + d:04X}", pc - start
            d = s8(mem[pc]); pc += 1
            return f"JR {CC[y - 4]},${start + 2 + d:04X}", pc - start
        if z == 1:
            if q == 0:
                nn = mem[pc] | (mem[pc + 1] << 8); pc += 2
                rp = idx if (idx and p == 2) else RP[p]
                return f"LD {rp},${nn:04X}", pc - start
            return f"ADD {hl()},{idx if (idx and p==2) else RP[p]}", pc - start
        if z == 2:
            if q == 0:
                if p == 0: return "LD (BC),A", pc - start
                if p == 1: return "LD (DE),A", pc - start
                nn = mem[pc] | (mem[pc + 1] << 8); pc += 2
                return (f"LD (${nn:04X}),{hl()}" if p == 2 else f"LD (${nn:04X}),A"), pc - start
            if p == 0: return "LD A,(BC)", pc - start
            if p == 1: return "LD A,(DE)", pc - start
            nn = mem[pc] | (mem[pc + 1] << 8); pc += 2
            return (f"LD {hl()},(${nn:04X})" if p == 2 else f"LD A,(${nn:04X})"), pc - start
        if z == 3:
            rp = idx if (idx and p == 2) else RP[p]
            return (f"INC {rp}" if q == 0 else f"DEC {rp}"), pc - start
        if z == 4:
            t = reg(y)
            if idx and y == 6: pc += 1
            return f"INC {t}", pc - start
        if z == 5:
            t = reg(y)
            if idx and y == 6: pc += 1
            return f"DEC {t}", pc - start
        if z == 6:
            t = reg(y)
            if idx and y == 6: pc += 1
            n = mem[pc]; pc += 1
            return f"LD {t},${n:02X}", pc - start
        misc = {0: "RLCA", 1: "RRCA", 2: "RLA", 3: "RRA", 4: "DAA", 5: "CPL", 6: "SCF", 7: "CCF"}
        return misc[y], pc - start

    if x == 1:
        if z == 6 and y == 6:
            return "HALT", pc - start
        dst = reg(y); src = reg(z)
        # only one (IX+d) displacement byte is consumed total
        if idx and (y == 6 or z == 6):
            pc += 1
        return f"LD {dst},{src}", pc - start

    if x == 2:
        t = reg(z)
        if idx and z == 6: pc += 1
        return f"{ALU[y]}{t}", pc - start

    # x == 3
    if z == 0:
        return f"RET {CC[y]}", pc - start
    if z == 1:
        if q == 0:
            return f"POP {idx if (idx and p==2) else RP2[p]}", pc - start
        if p == 0: return "RET", pc - start
        if p == 1: return "EXX", pc - start
        if p == 2: return f"JP ({hl()})", pc - start
        return f"LD SP,{hl()}", pc - start
    if z == 2:
        nn = mem[pc] | (mem[pc + 1] << 8); pc += 2
        return f"JP {CC[y]},${nn:04X}", pc - start
    if z == 3:
        if y == 0:
            nn = mem[pc] | (mem[pc + 1] << 8); pc += 2
            return f"JP ${nn:04X}", pc - start
        if y == 2:
            n = mem[pc]; pc += 1
            return f"OUT (${n:02X}),A", pc - start
        if y == 3:
            n = mem[pc]; pc += 1
            return f"IN A,(${n:02X})", pc - start
        misc = {4: f"EX (SP),{hl()}", 5: "EX DE,HL", 6: "DI", 7: "EI"}
        return misc[y], pc - start
    if z == 4:
        nn = mem[pc] | (mem[pc + 1] << 8); pc += 2
        return f"CALL {CC[y]},${nn:04X}", pc - start
    if z == 5:
        if q == 0:
            return f"PUSH {idx if (idx and p==2) else RP2[p]}", pc - start
        nn = mem[pc] | (mem[pc + 1] << 8); pc += 2
        return f"CALL ${nn:04X}", pc - start
    if z == 6:
        n = mem[pc]; pc += 1
        return f"{ALU[y]}${n:02X}", pc - start
    return f"RST ${y * 8:02X}", pc - start


def disasm_range(mem: bytes, start: int, length: int) -> None:
    pc = start
    end = start + length
    while pc < end:
        text, n = disasm_one(mem, pc)
        raw = " ".join(f"{mem[pc + i]:02X}" for i in range(n))
        print(f"{pc:04X}: {raw:<14} {text}")
        pc += n


def find_refs(mem: bytes, target: int) -> None:
    lo, hi = target & 0xFF, (target >> 8) & 0xFF
    print(f"=== byte refs to ${target:04X} (LE {lo:02X} {hi:02X}) ===")
    for i in range(len(mem) - 2):
        if mem[i + 1] == lo and mem[i + 2] == hi:
            prev = mem[i]
            # opcodes that take a 16-bit immediate where this could be operand
            tag = {0x21: "LD HL,", 0x11: "LD DE,", 0x01: "LD BC,", 0x31: "LD SP,",
                   0xC3: "JP ", 0xCD: "CALL ", 0x22: "LD (nn),HL", 0x2A: "LD HL,(nn)",
                   0x32: "LD (nn),A", 0x3A: "LD A,(nn)"}.get(prev, "")
            print(f"  @{i:04X}: {prev:02X} {lo:02X} {hi:02X}   {tag}${target:04X}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("start", nargs="?", default="0x2700")
    ap.add_argument("length", nargs="?", default="0x80")
    ap.add_argument("--find", type=lambda x: int(x, 0))
    args = ap.parse_args()
    mem = load_prog()
    if args.find is not None:
        find_refs(mem, args.find)
        return 0
    disasm_range(mem, int(args.start, 0), int(args.length, 0))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
