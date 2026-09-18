package de.sb.knx.bus;

import de.sb.knx.http.Events;
import de.sb.knx.json.Json;
import tuwien.auto.calimero.CloseEvent;
import tuwien.auto.calimero.DataUnitBuilder;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.KNXRemoteException;
import tuwien.auto.calimero.knxnetip.Discoverer;
import tuwien.auto.calimero.knxnetip.servicetype.SearchResponse;
import tuwien.auto.calimero.knxnetip.util.DeviceDIB;
import tuwien.auto.calimero.knxnetip.util.HPAI;
import tuwien.auto.calimero.knxnetip.util.ServiceFamiliesDIB;
import tuwien.auto.calimero.link.KNXLinkClosedException;
import tuwien.auto.calimero.link.KNXNetworkLink;
import tuwien.auto.calimero.link.KNXNetworkLinkIP;
import tuwien.auto.calimero.link.NetworkLinkListener;
import tuwien.auto.calimero.link.medium.TPSettings;
import tuwien.auto.calimero.mgmt.Destination;
import tuwien.auto.calimero.mgmt.ManagementClientImpl;
import tuwien.auto.calimero.mgmt.ManagementProceduresImpl;
import tuwien.auto.calimero.mgmt.TransportLayer;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Haelt die Busverbindung und fuehrt alle Zugriffe streng nacheinander aus.
 * Der KNX-Bus ist ein serielles Medium und die Managementprozeduren sind zustandsbehaftet -
 * paralleler Zugriff wuerde laufende Transportverbindungen zerreissen.
 */
public final class BusService implements AutoCloseable {

    /** Ein einziger Managementstapel pro Verbindung.
     *  Zwei Transportschichten auf demselben Link wuerden sich gegenseitig die
     *  verbindungsorientierten Telegramme wegtrennen (T_Disconnect auf unbekannte Ziele). */
    static final class SharedClient extends ManagementClientImpl {
        SharedClient(KNXNetworkLink link) throws KNXLinkClosedException {
            super(link);
        }

        TransportLayer sharedTransportLayer() {
            return transportLayer();
        }

        /**
         * A_PropertyValue_Write fuer Properties, deren Antwort anders aussieht als der Schreibwert.
         * PID_LOAD_STATE_CONTROL (PDT_CONTROL) nimmt 10 Oktette an und antwortet mit einem Oktett
         * Ladezustand (03/05/01 4.23.2.1) - writeProperty verlangt gleich lange Antwortdaten und wirft.
         * Liefert die Daten der A_PropertyValue_Response.
         */
        byte[] writeControlProperty(Destination dst, int objIndex, int pid, int start, int elements, byte[] data)
                throws KNXException, InterruptedException {
            byte[] asdu = new byte[4 + data.length];
            asdu[0] = (byte) objIndex;
            asdu[1] = (byte) pid;
            asdu[2] = (byte) ((elements << 4) | ((start >> 8) & 0x0F));
            asdu[3] = (byte) start;
            System.arraycopy(data, 0, asdu, 4, data.length);
            byte[] apdu = DataUnitBuilder.createAPDU(PROPERTY_WRITE, asdu);
            byte[] res = sendWait(dst, getPriority(), apdu, PROPERTY_RESPONSE, 4, 250, responseTimeout());
            // Antwort: 2 Oktette APCI, Objektindex, PID, Anzahl/Start, Start, Daten
            if (res.length < 6 || ((res[4] & 0xFF) >> 4) == 0) {
                throw new KNXRemoteException("Property " + pid + ": Schreiben abgelehnt");
            }
            return Arrays.copyOfRange(res, 6, res.length);
        }

        private static final int PROPERTY_WRITE = 0x03D7;
        private static final int PROPERTY_RESPONSE = 0x03D6;
    }

    static final class SharedProcedures extends ManagementProceduresImpl {
        SharedProcedures(SharedClient client) {
            super(client, client.sharedTransportLayer());
        }
    }

    private final Events events;

    private volatile ExecutorService bus = newExecutor();

    private volatile KNXNetworkLink link;
    private volatile SharedClient client;
    private volatile SharedProcedures procedures;
    private volatile Map<String, Object> description = Json.obj();

    /** Adresse der KNXnet/IP-Schnittstelle selbst - noetig, um das Programmieren der
     *  eigenen Schnittstelle zu erkennen. Die Oberflaeche liefert sie aus der Suche mit. */
    private volatile String interfaceAddress;
    private volatile String lostReason;

    public BusService(Events events) {
        this.events = events;
    }

    private static ExecutorService newExecutor() {
        return Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "knx-bus");
            t.setDaemon(true);
            return t;
        });
    }

    public ExecutorService executor() {
        return bus;
    }

    public boolean connected() {
        KNXNetworkLink l = link;
        return l != null && l.isOpen();
    }

    public String interfaceAddress() {
        return interfaceAddress;
    }

    public <T> T call(Callable<T> task, long timeoutSeconds) throws Exception {
        ExecutorService exec = bus;
        Future<T> f;
        try {
            f = exec.submit(task);
        } catch (RejectedExecutionException e) {
            throw new IllegalStateException("Der Buszugriff wurde gerade zurueckgesetzt. Bitte neu verbinden.");
        }
        try {
            return f.get(timeoutSeconds, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            // Haengt der Busthread, ist die Schnittstelle meist selbst verschwunden - etwa weil
            // sie gerade eine neue Adresse bekommen hat und neu startet. Ohne Aufgeben wuerde
            // jeder weitere Zugriff hinter dem haengenden Auftrag in der Warteschlange stehen.
            f.cancel(true);
            abandon("Keine Antwort innerhalb von " + timeoutSeconds + " s");
            throw e;
        }
    }

    /**
     * Gibt die Verbindung auf: Link schliessen und den moeglicherweise haengenden Busthread
     * fallen lassen. Der alte Thread ist ein Daemon und endet, sobald Calimero den
     * geschlossenen Link bemerkt - blockiert aber nichts mehr.
     */
    public synchronized void abandon(String reason) {
        boolean had = link != null;
        lostReason = reason;
        KNXNetworkLink l = link;
        link = null;
        client = null;
        procedures = null;
        description = Json.obj();
        if (l != null) {
            try {
                l.close();
            } catch (RuntimeException ignored) {
                // Der Link war ohnehin nicht mehr zu gebrauchen.
            }
        }
        ExecutorService old = bus;
        bus = newExecutor();
        old.shutdownNow();
        if (had) announceLost(reason);
    }

    private void announceLost(String reason) {
        if (events == null) return;
        events.log("warn", "Busverbindung verloren: " + reason);
        Map<String, Object> m = Json.obj();
        m.put("connected", false);
        m.put("reason", reason);
        m.put("interfaceAddress", interfaceAddress);
        events.publish("bus", m);
    }

    /* ---------------- Suche ---------------- */

    /** KNXnet/IP-Server im Netz suchen. Braucht keine Verbindung und laeuft daher am Busthread vorbei. */
    public static List<Map<String, Object>> discover(int seconds) throws Exception {
        Discoverer d = Discoverer.udp(false).timeout(Duration.ofSeconds(seconds));
        List<Discoverer.Result<SearchResponse>> results =
                d.search().get(seconds + 3L, TimeUnit.SECONDS);

        List<Map<String, Object>> out = new ArrayList<>();
        // Calimero sendet eine einfache und eine erweiterte Suche (KNXnet/IP Core v2).
        // Ein v2-Server beantwortet beide, liefert also zwei gleiche Ergebnisse.
        Set<String> seen = new HashSet<>();
        for (Discoverer.Result<SearchResponse> r : results) {
            SearchResponse res = r.response();
            DeviceDIB dev = res.getDevice();
            HPAI control = res.getControlEndpoint();

            String host = control.getAddress() == null || control.getAddress().isAnyLocalAddress()
                    ? r.remoteEndpoint().getAddress().getHostAddress()
                    : control.getAddress().getHostAddress();

            if (!seen.add(dev.serialNumber() + "|" + host + ":" + control.getPort())) continue;

            Map<String, Object> m = Json.obj();
            m.put("name", dev.getName());
            m.put("host", host);
            m.put("port", control.getPort());
            m.put("address", dev.getAddress().toString());
            m.put("serial", dev.serialNumber().toString());
            m.put("medium", dev.getKNXMediumString());
            m.put("mac", dev.getMACAddressString());
            m.put("projectInstallId", dev.getProjectInstallID());
            m.put("networkInterface", r.networkInterface() == null ? null : r.networkInterface().getName());

            List<String> families = new ArrayList<>();
            boolean tunneling = false;
            boolean routing = false;
            ServiceFamiliesDIB fam = res.getServiceFamilies();
            if (fam != null) {
                for (Map.Entry<ServiceFamiliesDIB.ServiceFamily, Integer> e : fam.families().entrySet()) {
                    families.add(e.getKey().name() + " v" + e.getValue());
                    if (e.getKey() == ServiceFamiliesDIB.ServiceFamily.Tunneling) tunneling = true;
                    if (e.getKey() == ServiceFamiliesDIB.ServiceFamily.Routing) routing = true;
                }
            }
            m.put("services", families);
            m.put("tunneling", tunneling);
            m.put("routing", routing);
            out.add(m);
        }
        return out;
    }

    public static List<Map<String, Object>> networkInterfaces() throws Exception {
        List<Map<String, Object>> out = new ArrayList<>();
        for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!ni.isUp() || ni.isLoopback() || !ni.supportsMulticast()) continue;
            List<String> addresses = new ArrayList<>();
            for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                if (a.getAddress().length == 4) addresses.add(a.getHostAddress());
            }
            if (addresses.isEmpty()) continue;
            Map<String, Object> m = Json.obj();
            m.put("name", ni.getName());
            m.put("display", ni.getDisplayName());
            m.put("addresses", addresses);
            out.add(m);
        }
        return out;
    }

    /* ---------------- Verbinden ---------------- */

    public Map<String, Object> connectTunneling(String host, int port, boolean nat, String localHost,
                                                String deviceAddress) throws Exception {
        return call(() -> {
            closeLink();
            InetSocketAddress server = new InetSocketAddress(InetAddress.getByName(host), port);
            InetSocketAddress local = localHost == null || localHost.isBlank()
                    ? new InetSocketAddress(0)
                    : new InetSocketAddress(InetAddress.getByName(localHost), 0);
            link = KNXNetworkLinkIP.newTunnelingLink(local, server, nat, new TPSettings());
            attach();
            interfaceAddress = deviceAddress == null || deviceAddress.isBlank() ? null : deviceAddress;
            lostReason = null;

            Map<String, Object> d = Json.obj();
            d.put("mode", "tunneling");
            d.put("host", host);
            d.put("port", port);
            d.put("nat", nat);
            d.put("deviceAddress", interfaceAddress);
            description = d;
            return status();
        }, 30);
    }

    public Map<String, Object> connectRouting(String multicast, String networkInterface, String ownAddress)
            throws Exception {
        return call(() -> {
            closeLink();
            InetAddress group = InetAddress.getByName(
                    multicast == null || multicast.isBlank() ? "224.0.23.12" : multicast);
            NetworkInterface ni = networkInterface == null || networkInterface.isBlank()
                    ? null
                    : NetworkInterface.getByName(networkInterface);
            if (networkInterface != null && !networkInterface.isBlank() && ni == null) {
                throw new IllegalArgumentException("Netzwerkschnittstelle nicht gefunden: " + networkInterface);
            }
            // Beim Routing setzt kein Server eine Adresse - ohne eigene Adresse waere der
            // Absender 0.0.0 und Managementantworten koennten nicht zugestellt werden.
            TPSettings settings = ownAddress == null || ownAddress.isBlank()
                    ? new TPSettings(new IndividualAddress(15, 15, 250))
                    : new TPSettings(Knx.address(ownAddress));
            link = KNXNetworkLinkIP.newRoutingLink(ni, group, settings);
            attach();
            interfaceAddress = null;
            lostReason = null;

            Map<String, Object> d = Json.obj();
            d.put("mode", "routing");
            d.put("multicast", group.getHostAddress());
            d.put("networkInterface", ni == null ? null : ni.getName());
            d.put("ownAddress", settings.getDeviceAddress().toString());
            description = d;
            return status();
        }, 30);
    }

    public Map<String, Object> disconnect() throws Exception {
        return call(() -> {
            closeLink();
            description = Json.obj();
            interfaceAddress = null;
            lostReason = null;
            return status();
        }, 20);
    }

    public Map<String, Object> status() {
        Map<String, Object> m = Json.obj();
        KNXNetworkLink l = link;
        boolean open = l != null && l.isOpen();
        m.put("connected", open);
        m.put("connection", description);
        m.put("interfaceAddress", interfaceAddress);
        m.put("reason", open ? null : lostReason);
        if (open) {
            m.put("linkAddress", l.getKNXMedium().getDeviceAddress().toString());
            m.put("link", l.getName());
        }
        return m;
    }

    private void attach() throws KNXLinkClosedException {
        client = new SharedClient(link);
        client.responseTimeout(Duration.ofSeconds(5));
        procedures = new SharedProcedures(client);

        // Faellt der Tunnel von selbst weg - etwa weil die Schnittstelle neu startet -,
        // soll die Oberflaeche das erfahren und nicht in Zeitueberschreitungen laufen.
        final KNXNetworkLink watched = link;
        watched.addLinkListener(new NetworkLinkListener() {
            @Override
            public void linkClosed(CloseEvent e) {
                if (e.getInitiator() == CloseEvent.USER_REQUEST) return;
                if (link != watched) return;
                abandon(e.getReason() == null || e.getReason().isBlank()
                        ? "Die Schnittstelle hat die Verbindung beendet" : e.getReason());
            }
        });
    }

    private void closeLink() {
        if (procedures != null) {
            try {
                procedures.detach();
            } catch (RuntimeException ignored) {
                // Verbindung war schon zerfallen
            }
            procedures = null;
        }
        if (client != null) {
            try {
                client.detach();
            } catch (RuntimeException ignored) {
                // dito
            }
            client = null;
        }
        if (link != null) {
            link.close();
            link = null;
        }
    }

    /* ---------------- Zugriff fuer die Prozeduren ---------------- */

    SharedClient client() {
        return require(client);
    }

    SharedProcedures procedures() {
        return require(procedures);
    }

    private <T> T require(T value) {
        if (value == null || link == null || !link.isOpen()) {
            throw new IllegalStateException(lostReason == null
                    ? "Keine Busverbindung. Bitte zuerst eine Schnittstelle verbinden."
                    : "Keine Busverbindung mehr (" + lostReason + "). Bitte neu verbinden.");
        }
        return value;
    }

    /**
     * Oeffnet eine verbindungsorientierte Transportverbindung und raeumt sie in jedem Fall wieder ab.
     * Calimero laesst pro Adresse nur ein Ziel gleichzeitig zu.
     */
    <T> T withDestination(IndividualAddress address, DestinationTask<T> task) throws KNXException, InterruptedException {
        Destination d = client().createDestination(address, true);
        try {
            return task.run(d);
        } finally {
            d.destroy();
        }
    }

    interface DestinationTask<T> {
        T run(Destination destination) throws KNXException, InterruptedException;
    }

    @Override
    public void close() {
        ExecutorService exec = bus;
        try {
            exec.submit(this::closeLink).get(10, TimeUnit.SECONDS);
        } catch (Exception ignored) {
            // beim Herunterfahren nicht weiter stoeren
        }
        exec.shutdownNow();
    }
}
