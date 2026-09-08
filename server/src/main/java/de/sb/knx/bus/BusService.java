package de.sb.knx.bus;

import de.sb.knx.json.Json;
import tuwien.auto.calimero.IndividualAddress;
import tuwien.auto.calimero.KNXException;
import tuwien.auto.calimero.knxnetip.Discoverer;
import tuwien.auto.calimero.knxnetip.servicetype.SearchResponse;
import tuwien.auto.calimero.knxnetip.util.DeviceDIB;
import tuwien.auto.calimero.knxnetip.util.HPAI;
import tuwien.auto.calimero.knxnetip.util.ServiceFamiliesDIB;
import tuwien.auto.calimero.link.KNXLinkClosedException;
import tuwien.auto.calimero.link.KNXNetworkLink;
import tuwien.auto.calimero.link.KNXNetworkLinkIP;
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
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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
    }

    static final class SharedProcedures extends ManagementProceduresImpl {
        SharedProcedures(SharedClient client) {
            super(client, client.sharedTransportLayer());
        }
    }

    private final ExecutorService bus = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "knx-bus");
        t.setDaemon(true);
        return t;
    });

    private KNXNetworkLink link;
    private SharedClient client;
    private SharedProcedures procedures;
    private Map<String, Object> description = Json.obj();

    public ExecutorService executor() {
        return bus;
    }

    public <T> T call(Callable<T> task, long timeoutSeconds) throws Exception {
        return bus.submit(task).get(timeoutSeconds, TimeUnit.SECONDS);
    }

    /* ---------------- Suche ---------------- */

    /** KNXnet/IP-Server im Netz suchen. Braucht keine Verbindung und laeuft daher am Busthread vorbei. */
    public static List<Map<String, Object>> discover(int seconds) throws Exception {
        Discoverer d = Discoverer.udp(false).timeout(Duration.ofSeconds(seconds));
        List<Discoverer.Result<SearchResponse>> results =
                d.search().get(seconds + 3L, TimeUnit.SECONDS);

        List<Map<String, Object>> out = new ArrayList<>();
        for (Discoverer.Result<SearchResponse> r : results) {
            SearchResponse res = r.response();
            DeviceDIB dev = res.getDevice();
            HPAI control = res.getControlEndpoint();

            String host = control.getAddress() == null || control.getAddress().isAnyLocalAddress()
                    ? r.remoteEndpoint().getAddress().getHostAddress()
                    : control.getAddress().getHostAddress();

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

    public Map<String, Object> connectTunneling(String host, int port, boolean nat, String localHost)
            throws Exception {
        return call(() -> {
            closeLink();
            InetSocketAddress server = new InetSocketAddress(InetAddress.getByName(host), port);
            InetSocketAddress local = localHost == null || localHost.isBlank()
                    ? new InetSocketAddress(0)
                    : new InetSocketAddress(InetAddress.getByName(localHost), 0);
            link = KNXNetworkLinkIP.newTunnelingLink(local, server, nat, new TPSettings());
            attach();

            Map<String, Object> d = Json.obj();
            d.put("mode", "tunneling");
            d.put("host", host);
            d.put("port", port);
            d.put("nat", nat);
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
            return status();
        }, 20);
    }

    public Map<String, Object> status() {
        Map<String, Object> m = Json.obj();
        KNXNetworkLink l = link;
        boolean open = l != null && l.isOpen();
        m.put("connected", open);
        m.put("connection", description);
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
            throw new IllegalStateException("Keine Busverbindung. Bitte zuerst eine Schnittstelle verbinden.");
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
        try {
            bus.submit(this::closeLink).get(10, TimeUnit.SECONDS);
        } catch (Exception ignored) {
            // beim Herunterfahren nicht weiter stoeren
        }
        bus.shutdownNow();
    }
}
