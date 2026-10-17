# Matriz de rúbrica y evidencias

Fecha de referencia: 16 de octubre de 2026. **Preparado** = existe artefacto; **por verificar** = requiere ejecución o revisión; **pendiente** = falta entrega externa/función. Esta tabla no adjudica nota ni confirma envíos académicos.

| Criterio                              | Evidencia preparada                                                                    | Verificación necesaria                                                                       | Estado documental                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Negocio y anatomía (4 puntos)         | `PRODUCT.md`, `fase1/ENTREGA.md`; cadena de valor, objetivos, monetización y anatomía  | Revisión de coherencia con fuentes y presentación                                            | Preparado; hipótesis de negocio sin medición real                         |
| Arquitectura y patrones (5 puntos)    | `ARCHITECTURE.md`, ADRs; Mermaid; `backend/src/adapters.ts`, `worker.ts`, `service.ts` | Tests de adaptación, resiliencia, idempotencia, CAS y recuperación                           | Validado localmente por unitarias, integración y smoke de contenedores    |
| Modelo y contrato (4 puntos)          | `DATA_MODEL.md`, `API_CONTRACT.md`, `shared/openapi.json`, `shared/example.json`       | `npm run contract`; pruebas de rutas reales y tipos                                          | PASS: OpenAPI principal y mocks; pruebas de schemas y rutas               |
| Implementación y seguridad (5 puntos) | `backend/src/app.ts`, `auth.ts`, `shared/security.ts`, frontend y mocks                | Login, roles/agencia, firma webhook, errores y flujo navegador                               | PASS local: unitarias/integración/E2E; no equivale a auditoría productiva |
| Unitarias >80 % (mismo criterio)      | Configuración V8 y tests backend; objetivo >=85 %                                      | `npm run test:unit`; HTML/JSON/lcov unitario, sin DB/red                                     | PASS: 102 unitarias; 100 % líneas/sentencias/funciones, 99,68 % ramas     |
| Estrés/carga (mismo criterio)         | Scripts y guía en `TESTING.md`                                                         | Sostenida 100–200 VUs y spike ~500 con duración de rúbrica; percentiles/errores/recuperación | Un smoke o un script no acreditan ambos escenarios                        |
| Despliegue y sustentación (2 puntos)  | `DEPLOYMENT.md`, `CICD.md`, `DEFENSA.md`, contenedores/plantillas locales              | Ambiente público accesible y exposición grupal                                               | Cloud pendiente por límite explícito de esta etapa                        |

## Entregables por unidad

| Unidad / fecha fuente | Archivo principal          | Frontera                                                           |
| --------------------- | -------------------------- | ------------------------------------------------------------------ |
| U1 · 3 octubre 2026   | [Fase 1](fase1/ENTREGA.md) | Documento preparado; envío plataforma no consultado                |
| U2 · 17 octubre 2026  | [Fase 2](fase2/ENTREGA.md) | Arquitectura actualizada; envío plataforma no consultado           |
| U3 · 23 octubre 2026  | [Fase 3](fase3/ENTREGA.md) | Modelo/contrato y resultados verificables                          |
| U4 · 29 octubre 2026  | [Fase 4](fase4/ESTADO.md)  | Local implementado; cloud y sustentación requieren siguiente etapa |

Resultados y límites de medición: [EVIDENCIAS](pruebas/EVIDENCIAS.md). El smoke k6 de 5 VUs pasó; sostenida y pico completos siguen pendientes.

Los detalles de cobertura funcional están en [REQUIREMENTS](REQUIREMENTS.md), sin reducir la matriz a los requisitos fáciles. La fuente de puntuación es [rubrica.txt](fuentes/rubrica.txt). Su texto histórico sobre intentos/tiempo restante no describe el estado actual de la plataforma.
