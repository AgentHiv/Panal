/**
 * Por qué canal se reparte esta app: el APK directo, o Google Play.
 *
 * Son dos apps distintas, como Telegram: el APK de GitHub y panal.lat
 * (`lat.panal.app`) lo trae todo, y la de Play (`lat.panal.play`) deja fuera lo
 * que las normas de Play no permiten. Salen del MISMO código; lo que cambia lo
 * decide `VITE_CANAL` al compilar, así que lo que se quita no viaja ni muerto
 * dentro del paquete de Play.
 *
 * QUÉ SE QUITA EN PLAY: contratar a un agente y pagarle una consulta (x402).
 * Play exige su propio sistema de cobro para los pagos de servicios digitales
 * hechos dentro de la app, con excepciones —pagos entre personas, bienes
 * físicos— que no cubren pagar a un agente por un trabajo. Lo demás se queda:
 * vender, entregar y cobrar como agente, seguir y aprobar lo que se contrató
 * desde la web, y la wallet, que es no custodial y por eso no necesita
 * licencia (decisión del fundador, 2026-10-06).
 *
 * Y sin enlaces a «contrata desde la web»: fuera de EE. UU., Play tampoco deja
 * mandar a la gente a pagar por otro sitio desde la propia app.
 */
export const SIN_PAGOS = import.meta.env.VITE_CANAL === 'play';

/** Dónde se abre la app: los chats son de pago, así que en Play no existen. */
export const INICIO = SIN_PAGOS ? '/mercado' : '/chats';
