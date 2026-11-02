/**
 * Entradas iniciales de Mecánicas (FAQ). Se insertan una sola vez, cuando la colección
 * `faq` todavía no existe; después el admin las edita, reordena o borra desde la app.
 * Ids fijos: si dos peticiones siembran a la vez, la segunda choca y no duplica nada.
 */
export type FaqSeed = { id: string; category: string; title: string; body: string };

export const FAQ_SEED: FaqSeed[] = [
  {
    id: '6a0f00000000000000000001',
    category: 'App',
    title: '¿Qué puede hacer cada rol (Admin, User, Invitado)?',
    body: [
      '- **Admin** (con PIN): edita todo. Oro, tokens, items, aumentos, puntos del mapa, desbloqueos de las fichas y estas Mecánicas.',
      '- **User**: al entrar eliges tu player y vas directo a tu ficha. Puedes editar tu ficha (también el fondo) y usar la Tienda (comprar, vender y craftear).',
      '- **Invitado**: entra como User sin ser ningún player, para mirar.',
      '',
      'Para cambiar de rol o de player, usa «Cambiar rol» en el menú lateral.',
    ].join('\n'),
  },
  {
    id: '6a0f00000000000000000002',
    category: 'Party',
    title: '¿Cómo funciona el oro?',
    body: [
      'El oro es **común a toda la party** y se ve en la cabecera.',
      '- Se gasta al comprar en la Tienda, al craftear y en la ruleta de aumentos (si tiene coste).',
      '- Al vender un objeto, el oro vuelve a la party.',
      '- El admin puede dar o quitar oro a mano.',
      '',
      'Si no hay oro suficiente, la compra o el crafteo no se hace y te dice cuánto falta.',
    ].join('\n'),
  },
  {
    id: '6a0f00000000000000000003',
    category: 'Ficha',
    title: 'Descansos: corto y largo',
    body: [
      '- **Descanso corto**: recupera la mitad de los PG y del maná que te faltan (redondeando hacia arriba). Hay **2 por cada descanso largo**.',
      '- **Descanso largo**: PG y maná al máximo, quita la vida temporal y el escudo, y vuelve a dar los 2 cortos.',
      '',
      'Los aplica el admin desde la ficha.',
    ].join('\n'),
  },
  {
    id: '6a0f00000000000000000004',
    category: 'Ficha',
    title: 'Inspiración',
    body: 'Como en D&D 5e: la tienes o no la tienes. Se concede y se gasta con un clic en la ficha (botón «Inspiración», Activa/Inactiva). Gastarla da **ventaja** en una tirada.',
  },
  {
    id: '6a0f00000000000000000005',
    category: 'Ficha',
    title: 'Pestañas Quest y Aumentos con candado',
    body: 'Las pestañas **Quest** y **Aumentos** de la ficha salen con candado hasta que el admin las desbloquea para ese player. El admin también puede ocultarlas aunque estén desbloqueadas.',
  },
  {
    id: '6a0f00000000000000000006',
    category: 'Ficha',
    title: 'Niveles 19 y 20: la Quest de top',
    body: 'Los niveles **19 y 20** de la tabla de rol están cerrados. Se abren al completar la **«Quest de top»** de ese player (una quest con «top» en el nombre).',
  },
  {
    id: '6a0f00000000000000000007',
    category: 'Objetos',
    title: 'Tokens de spawn y de roll',
    body: [
      'En **Item Roll**, cada botón gasta un token de la party:',
      '- **Spawn Básico / Épico**: gira una ruleta Sí/No con la probabilidad de spawn. Si sale **Sí**, ganas un token de **Roll** de esa rareza.',
      '- **Roll Básico / Épico / Legendario**: abre la caja de botín de esa rareza y te da el objeto.',
      '',
      'El admin da a mano los tokens de Spawn Básico, Spawn Épico y Legendario. Los de Roll Básico y Épico solo salen de la ruleta de spawn.',
    ].join('\n'),
  },
  {
    id: '6a0f00000000000000000008',
    category: 'Objetos',
    title: 'Crafteo y botas',
    body: [
      '- Al craftear se gastan las piezas libres de la receta y el **oro que falta** hasta el coste del resultado.',
      '- Además hay una tarifa por rareza: **+400** si es épico y **+800** si es legendario.',
      '- Lo que lleva puesto un player no cuenta como pieza libre.',
      '- Las **botas no se compran**: se mejoran crafteando (las mejores piden un item de misión).',
      '- Los objetos Iniciales y Prismáticos tampoco están a la venta.',
    ].join('\n'),
  },
  {
    id: '6a0f00000000000000000009',
    category: 'Aumentos',
    title: 'Ruleta de aumentos',
    body: [
      '1. Gira la ruleta y sale una rareza: **Plata, Oro o Prismático**.',
      '2. Aparecen 3 aumentos al azar de esa rareza.',
      '3. Te quedas con uno.',
      '',
      'El admin decide las probabilidades (por defecto 70 / 25 / 5) y el coste en oro por tirada. La pantalla Aumentos solo la ven los players cuando el admin la habilita.',
    ].join('\n'),
  },
  {
    id: '6a0f0000000000000000000a',
    category: 'Aumentos',
    title: 'Niveles de los aumentos',
    body: 'Algunos aumentos tienen niveles propios (**1, 2 y 3**), cada uno con su efecto, y no dependen del nivel del player. No todos los tienen y no hace falta que tengan los tres.',
  },
  {
    id: '6a0f0000000000000000000b',
    category: 'Mapa',
    title: 'Ubicación de la party',
    body: 'En el Mapa, la bandera 🚩 marca dónde está la party. **Solo hay una**: si el admin la pone en otro sitio, se mueve. Pulsa «Ir a la party» para centrar el mapa en ella. El admin también puede añadir otros puntos de interés 📍.',
  },
  {
    id: '6a0f0000000000000000000c',
    category: 'Mapa',
    title: 'Portal yordle',
    body: 'El portal a la Ciudad de Bandle **cambia de sitio cada día** a medianoche (hora de Madrid). Va rotando entre las 66 ubicaciones del mapa oficial de Riot y todos lo ven en el mismo sitio. Pulsa «Ir al portal yordle» para encontrarlo.',
  },
];
