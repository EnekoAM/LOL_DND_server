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
    title: 'Crafteo',
    body: [
      'En la **Tienda** (pestaña **Crafteo**) puedes fabricar un objeto a partir de piezas de tu almacén, o comprarlo directamente.',
      '',
      '**Coste del crafteo**',
      '- Precio del objeto **menos** el valor de las piezas que ya tienes (en cualquier nivel del árbol de la receta).',
      '- Más un **10%** del precio de **cada** objeto que haya que fabricar (intermedios y el final).',
      '- Si faltan piezas básicas, puedes comprarlas al precio de tienda en el mismo paso con **«Comprar lo que falta y craftear»**.',
      '',
      '**Detalles**',
      '- Las piezas usadas se consumen. Las copias equipadas no cuentan como libres.',
      '- El árbol muestra con **✓** lo que ya tienes y el precio de lo que falta.',
      '- Craftear suele compensar cuando las piezas las conseguiste gratis (botín, Item Roll). Si compras todas las piezas, el total sale algo más caro que comprar el objeto directo.',
      '',
      '**Ejemplo — Verdugo de Krakens (3000 oro)**',
      'Con 3 Espadas largas y 2 Dagas (1550 oro de crédito):',
      '- 3000 − 1550 = **1450**',
      '- + 10% de Rectrice (**78**) + Hacha hogareña (**120**) + Arco curvo (**70**) + Verdugo (**300**) = **568**',
      '- Total a pagar: **2018 oro**',
      '',
      '**Otros**',
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
