package de.sb.knx.api;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import de.sb.knx.chat.ChatService;
import de.sb.knx.http.Events;
import de.sb.knx.http.Http;
import de.sb.knx.json.Json;
import de.sb.knx.store.FileStore;

import java.io.IOException;
import java.util.Map;

/** KI-Chat im Fenster: Zustand, Nachricht senden, anhalten, neues Gespraech. Antworten kommen als Ereignis. */
public final class ChatApi implements HttpHandler {

    private final ChatService chat;
    private final int port;

    public ChatApi(ChatService chat, int port) {
        this.chat = chat;
        this.port = port;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        if (!Http.localOnly(ex, port)) return;
        String path = ex.getRequestURI().getPath();
        String window = Events.windowId(ex.getRequestHeaders().getFirst("X-SB-Window"));
        try {
            switch (path) {
                case "/api/chat/status" -> Http.json(ex, 200, chat.status(window));
                case "/api/chat/send" -> {
                    requirePost(ex);
                    Map<String, Object> body = Json.parseObject(Http.text(ex, 1 << 20));
                    String project = Json.str(body, "project", null);
                    if (project == null) throw new IllegalArgumentException("Feld project fehlt");
                    Http.json(ex, 200, chat.send(window, FileStore.safeId(project), Json.str(body, "text", ""), body));
                }
                case "/api/chat/stop" -> {
                    requirePost(ex);
                    Map<String, Object> m = Json.obj();
                    m.put("stopped", chat.stop(window));
                    Http.json(ex, 200, m);
                }
                case "/api/chat/reset" -> {
                    requirePost(ex);
                    chat.reset(window);
                    Map<String, Object> m = Json.obj();
                    m.put("ok", true);
                    Http.json(ex, 200, m);
                }
                default -> Http.error(ex, 404, "Unbekannter Pfad");
            }
        } catch (IllegalArgumentException | IllegalStateException e) {
            Http.error(ex, 400, String.valueOf(e.getMessage()));
        }
    }

    private static void requirePost(HttpExchange ex) {
        if (!"POST".equals(ex.getRequestMethod())) throw new IllegalArgumentException("POST erwartet");
    }
}
