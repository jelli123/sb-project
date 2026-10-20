package de.sb.knx.bus;

import tuwien.auto.calimero.IndividualAddress;

import java.util.Arrays;

/**
 * Ein System-B-Geraet (Maske 07B0h): Objektliste wie in knx_master.xml (Index 3 Objekttabelle,
 * 4 Applikation, 5 PEI), Load State Machines mit relativer Zuteilung (03/05/02 3.31.3.4),
 * PID_TABLE_REFERENCE, PID_PROGRAM_VERSION und PID_MCB_TABLE mit CRC16-CCITT ueber den
 * zugeteilten Block (03/05/01 4.2.7, 4.2.13, 4.2.27), Speicherdienste auch oberhalb 64 KiB.
 */
final class SimulatedSystemBDevice extends SimulatedDevice {

    /** Ein Interface-Objekt mit Load State Machine; die Lage seines Blocks bestimmt das Geraet. */
    static final class Obj {
        final int type;
        volatile int base;
        int state, ref, size;
        byte[] version = new byte[5];

        Obj(int type, int base) {
            this.type = type;
            this.base = base;
        }
    }

    final byte[] memory = new byte[0x30000];
    /** Die Applikation liegt bei FFF0h und reicht ueber die 64-KiB-Grenze. */
    final Obj[] objects = {
        new Obj(0, 0), new Obj(1, 0x4000), new Obj(2, 0x4100), new Obj(9, 0x4200), new Obj(3, 0xFFF0), new Obj(4, 0x20000)
    };
    volatile int standardWrites, extendedWrites;
    volatile boolean restarted;
    /** Kippt beim Schreiben ein Bit an dieser Adresse - fuer die Pruefsumme. */
    volatile int faultyAddress = -1;

    SimulatedSystemBDevice(IndividualAddress address, IndividualAddress tool, FakeLink link) {
        super(address, tool, link);
    }

    @Override
    byte[] handle(byte[] a, int tpci) {
        int apci = apci(a);
        if ((apci & 0x3C0) == 0x300) return apdu(0x340, (byte) 0x07, (byte) 0xB0);
        if (apci == 0x3D1) return apdu(0x3D2, (byte) 0);                 // A_Authorize: Stufe 0
        if (apci == 0x380) {                                             // A_Restart
            restarted = true;
            disconnect();
            return null;
        }
        if ((apci & 0x3C0) == 0x280) {                                   // A_Memory_Write
            write(((a[2] & 0xFF) << 8) | (a[3] & 0xFF), a, 4, apci & 0x3F);
            standardWrites++;
            return null;
        }
        if ((apci & 0x3C0) == 0x200) {                                   // A_Memory_Read
            int n = apci & 0x3F, addr = ((a[2] & 0xFF) << 8) | (a[3] & 0xFF);
            byte[] r = apdu(0x240 | n, a[2], a[3]);
            byte[] out = Arrays.copyOf(r, r.length + n);
            System.arraycopy(memory, addr, out, r.length, n);
            return out;
        }
        if (apci == 0x1FB) {                                             // A_MemoryExtended_Write
            int n = a[2] & 0xFF, addr = ((a[3] & 0xFF) << 16) | ((a[4] & 0xFF) << 8) | (a[5] & 0xFF);
            write(addr, a, 6, n);
            extendedWrites++;
            return apdu(0x1FC, (byte) 0, a[3], a[4], a[5]);
        }
        if (apci == 0x1FD) {                                             // A_MemoryExtended_Read
            int n = a[2] & 0xFF, addr = ((a[3] & 0xFF) << 16) | ((a[4] & 0xFF) << 8) | (a[5] & 0xFF);
            byte[] r = apdu(0x1FE, (byte) 0, a[3], a[4], a[5]);
            byte[] out = Arrays.copyOf(r, r.length + n);
            System.arraycopy(memory, addr, out, r.length, n);
            return out;
        }
        if (apci == 0x3D8) return propertyDescription(a);
        if (apci == 0x3D5 || apci == 0x3D7) {
            int obj = a[2] & 0xFF, pid = a[3] & 0xFF;
            int n = (a[4] & 0xFF) >> 4, start = ((a[4] & 0x0F) << 8) | (a[5] & 0xFF);
            return propertyResponse(obj, pid, n, start,
                    property(apci == 0x3D7, obj, pid, n, start, Arrays.copyOfRange(a, 6, a.length)));
        }
        log.add("unbekannt " + Integer.toHexString(apci));
        return null;
    }

    private void write(int addr, byte[] src, int from, int n) {
        System.arraycopy(src, from, memory, addr, n);
        int f = faultyAddress;
        if (f >= addr && f < addr + n) memory[f] ^= 1;
    }

    private byte[] property(boolean write, int obj, int pid, int n, int start, byte[] data) {
        if (obj == 0) {
            if (write) return null;
            return switch (pid) {
                case 1 -> new byte[] {0, 0};
                case 56 -> new byte[] {0, (byte) 0xFE};
                case 78 -> new byte[] {0x00, (byte) 0x83, 0, 0, 0x04, 0x28};       // Hardwaretyp
                case 71 -> {
                    if (start == 0) yield new byte[] {0, (byte) objects.length};
                    byte[] r = new byte[2 * n];
                    for (int i = 0; i < n; i++) r[2 * i + 1] = (byte) objects[start - 1 + i].type;
                    yield r;
                }
                default -> null;
            };
        }
        if (obj >= objects.length) return null;
        Obj o = objects[obj];
        switch (pid) {
            case 1:
                return new byte[] {0, (byte) o.type};
            case 5:
                if (write) loadEvent(o, data);
                return new byte[] {(byte) o.state};
            case 7:
                return new byte[] {(byte) (o.ref >> 24), (byte) (o.ref >> 16), (byte) (o.ref >> 8), (byte) o.ref};
            case 13:
                if (write) o.version = data.clone();
                return o.version.clone();
            case 27: {
                if (write || o.state != 1 || o.size == 0) return null;
                int crc = crc16(Arrays.copyOfRange(memory, o.ref, o.ref + o.size));
                return new byte[] {(byte) (o.size >> 24), (byte) (o.size >> 16), (byte) (o.size >> 8), (byte) o.size,
                        0x00, (byte) 0xFF, (byte) (crc >> 8), (byte) crc};
            }
            default:
                return null;
        }
    }

    /** Load State Machine, Realisierungstyp 1 (03/05/01 4.23.2, Tabelle 94). */
    private void loadEvent(Obj o, byte[] d) {
        switch (d[0] & 0xFF) {
            case 4 -> { o.state = 0; o.ref = 0; }
            case 1 -> o.state = 2;
            case 3 -> {
                if (o.state != 2 || (d[1] & 0xFF) != 0x0B) { o.state = 3; return; }
                o.size = ((d[2] & 0xFF) << 24) | ((d[3] & 0xFF) << 16) | ((d[4] & 0xFF) << 8) | (d[5] & 0xFF);
                o.ref = o.base;
                if ((d[6] & 1) == 1) Arrays.fill(memory, o.ref, o.ref + o.size, d[7]);
            }
            case 2 -> { if (o.state == 2) o.state = 1; }
            default -> o.state = 3;
        }
    }
}
