# Truc mallorquí en línea

Servidor y página para jugar al Truc mallorquí por internet con amigos, en 3D y con señas.

- **Salas con código de 4 letras.** Uno crea la sala y los demás entran con el código o con el enlace.
- **Hasta 4 personas.** Los asientos libres los juegan bots. Si alguien se desconecta, un bot juega por él hasta que vuelva.
- **Las reglas viven en el servidor.** Cada jugador solo recibe sus propias cartas.
- **Cronómetro de 40 segundos** por decisión. Si se acaba, se tira la carta más baja o se dice "no vull".
- **Señas con la cara, mirada y frases** ("Vaig a tu", "Vina a mi", "Demana envit") entre jugadores reales.

## Contenido

```
server.js        servidor web + WebSocket (salas, asientos, reconexión)
game.js          reglas del juego, bots, señas y mirada
public/index.html  la página del juego (3D, sala, mensajes)
test/sim.js      pruebas automáticas con jugadores simulados
render.yaml      configuración opcional para Render
```

## Probarlo en tu ordenador

Necesitas Node.js 18 o superior.

```
npm install
npm start
```

Abre `http://localhost:3000`. Para jugar con otros móviles de tu misma wifi, usa la dirección de tu ordenador en la red, por ejemplo `http://192.168.1.20:3000`.

Pruebas automáticas (simulan 4 jugadores, un jugador con bots, un jugador que no responde y una reconexión):

```
npm test
```

## Publicarlo en internet con Render (plan gratuito)

Los precios y límites de los servicios cambian, así que comprueba las condiciones actuales en su web.

1. Crea una cuenta en GitHub y un repositorio nuevo. Sube el contenido de esta carpeta (sin la carpeta `node_modules`).
2. Crea una cuenta en Render (render.com) y conecta tu cuenta de GitHub.
3. En Render: **New** > **Web Service** y elige tu repositorio.
4. Ajustes:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Plan: **Free**
5. Pulsa **Create Web Service**. Al acabar te da una dirección tipo `https://tu-nombre.onrender.com`. Esa es la del juego.

Si prefieres, el archivo `render.yaml` hace estos pasos solo: en Render elige **New** > **Blueprint**.

HTTPS ya viene incluido, y la página usa conexión segura (`wss`) automáticamente.

### Cosas que conviene saber

- **El plan gratuito se duerme** tras un rato sin visitas. La primera persona que entre después puede esperar cerca de un minuto. Para partidas con amigos, abre la dirección unos minutos antes de empezar.
- **Las partidas viven en la memoria del servidor.** Si el servidor se reinicia o se despliega una versión nueva, las partidas en curso se pierden.
- **No se guardan datos.** Los nombres solo existen mientras dura la sala.
- **Otros alojamientos:** Railway, Fly.io o cualquier servidor con Node.js sirven igual. Hace falta que permita conexiones WebSocket.

## Qué no se ha podido probar

Se ha probado con jugadores simulados y con navegadores automáticos en un solo ordenador. Falta probar con móviles reales en redes distintas (datos móviles, wifi de casa) y con la latencia real. Las primeras partidas con amigos darán la información que falta.

## Variables opcionales

- `PORT`: puerto del servidor (lo pone el alojamiento).
- `TRUC_TIMER_MS`: milisegundos por decisión (por defecto 40000).
