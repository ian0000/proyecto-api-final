# Trabajo en este proyecto

Este repositorio es independiente. Use únicamente sus fuentes, código y decisiones; no importe historia, requisitos, credenciales ni convenciones de otros chats o proyectos.

## Fuentes y prioridades

1. La instrucción vigente del usuario limita el trabajo a lo local, antes de preparar ambientes de pruebas AWS/Azure/Atlas.
2. `docs/fuentes/prompt-maestro.txt` contiene las decisiones adaptadas del proyecto; los documentos originales y la rúbrica se conservan en `docs/fuentes/`.
3. `shared/openapi.json` define el contrato público; `shared/domain.ts` define los tipos compartidos. Mantenga ambos consistentes con código y pruebas.
4. `docs/REQUIREMENTS.md` conserva los 40 RF/RNF y sus brechas. No declare una función completa por existir un mock o un documento.

## Flujo de trabajo

Lea el módulo afectado y su documentación; aplique cambios acotados y ejecute la comprobación correspondiente. Backend o compartidos: lint, typecheck, contrato y pruebas relevantes; frontend: sus pruebas y build; documentación: `npm run docs:check`. El gate agregado es `npm run check`. Ejecute carga completa únicamente de manera deliberada sobre servicios locales ficticios.

Actualice contrato, pruebas y matriz cuando cambie comportamiento. Distinga resultados realmente observados de capacidades del código, simulaciones, objetivos y pendientes. Los reportes no deben inventar cobertura, p95, SLA, costos, URLs o resultados externos. Una validación local no prueba disponibilidad en nube.

## Límites técnicos

- Un monorepo; frontend React/Vite, API Fastify y worker, mocks separados y MongoDB local. Mantenga el diseño simple.
- Dinero: enteros en centavos USD; fechas ISO 8601; IDs de cliente ficticios `DEMO-`.
- Cola duradera embebida en la solicitud, lease y CAS en Mongo; no reemplazarla por timers volátiles.
- Autenticación JWT propia HS256 con vencimiento; no etiquetarla OAuth/OIDC.
- No registrar secretos ni datos personales reales. `.env` y reportes sensibles se excluyen de Git.
- Preserve `docs/fuentes/` y su manifiesto; nuevas conclusiones van en los documentos actualizados.
- El alcance vigente termina antes de preparar ambientes AWS/Azure/Atlas: no provisionar ni desplegar allí. Mantenga guías y plantillas sin crear recursos de nube. La publicación del repositorio GitHub prevista por el proyecto es independiente de desplegar la aplicación.

Estas instrucciones no añaden pasos de aprobación ni obligan a delegar. Actúe dentro del alcance ya autorizado y reporte límites concretos.
