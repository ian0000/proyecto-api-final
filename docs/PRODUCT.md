# Visión de producto y negocio · RA1

La Fábrica de Crédito centraliza la originación de crédito vehicular: un asesor registra una vez datos del cliente, vehículo y financiamiento, selecciona financieras, observa respuestas y compara ofertas. El problema descrito en las fuentes es la digitación repetida, seguimiento disperso en portales/correos y falta de comparación trazable. Es un caso académico inspirado en ese contexto; no se ha medido la operación real de Maresa.

## Usuarios, alcance y valor

| Actor               | Valor propuesto                        | Demostración local                                   |
| ------------------- | -------------------------------------- | ---------------------------------------------------- |
| Asesor              | Menor repetición y seguimiento central | Crear, filtrar, seguir, comparar, aceptar o desistir |
| Supervisor          | Visibilidad de su agencia              | Consulta restringida; aprobaciones pendientes        |
| Administrador       | Revisar fallos y operación             | Lectura global, métricas y reactivar DLQ             |
| Cliente ficticio    | Comparación comprensible               | Tasa, cuota, plazo, entrada, seguro y condiciones    |
| Financiera simulada | Recibir un formato propio              | Pichincha JSON/webhook; Pacífico XML/polling         |

No se evalúa riesgo crediticio real, desembolsa, formaliza, factura ni integra CRM. La decisión del mock es un escenario reproducible; no una evaluación financiera.

## Cadena de valor

| Eslabón       | Transformación                                    | Indicador propuesto                           |
| ------------- | ------------------------------------------------- | --------------------------------------------- |
| Activos       | Datos de una solicitud y relación con financieras | Un registro enviado a N destinos              |
| API           | Modelo canónico, validación y consentimiento      | Rechazos por forma; envíos sin consentimiento |
| Integraciones | Adaptadores que ocultan JSON/XML                  | Tiempo para incorporar otro adaptador         |
| Usuarios      | Estado y ofertas en una pantalla                  | Minutos de registro y seguimiento             |
| Negocio       | Menor esfuerzo y mejores oportunidades de cierre  | Conversión y tiempo hasta primera oferta      |

## Objetivos y medición

| Objetivo                     | Meta propuesta                            | Evidencia necesaria                                          |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Reducir registro             | <=5 minutos por solicitud                 | Sesión cronometrada de usuario; pendiente                    |
| Proteger consentimiento      | Cero envíos sin aceptación                | Pruebas negativas y validación API                           |
| Responder consultas/registro | p95 <2 s                                  | Reporte de carga por endpoint; 500 ms es meta ideal síncrona |
| Aislar fallos                | Una financiera no impide enviar a la otra | Escenario de fallo/reintento por adaptador                   |
| Mejorar conversión           | Medir ofertas aceptadas / solicitudes     | Línea base y reportes avanzados pendientes                   |
| Disponibilidad               | 99,5 % mensual                            | Monitoreo prolongado en nube; no probado localmente          |

Las metas de tiempo, disponibilidad y conversión no constituyen resultados observados.

## Monetización y naturaleza

El primer retorno sería **indirecto**: ahorro del tiempo del asesor y oportunidades de ventas. Una comisión por crédito formalizado requeriría acuerdos comerciales y un proceso de formalización que el MVP no implementa. Las suscripciones, cuotas y precios de fase1 son propuestas futuras sin clientes, contratos ni ingresos verificados. No se proyectan ingresos como si fueran reales.

La API es interna y de socios B2B en su visión, privada y académica en su ejecución actual. Su anatomía incluye recursos `/v1/solicitudes`, métodos GET/POST, parámetros de ruta y consulta, encabezados de idempotencia/concurrencia, JSON canónico, códigos HTTP, JWT y documentación OpenAPI. Las respuestas al navegador son síncronas; la interacción con financieras usa trabajo persistente asíncrono y consistencia eventual. La futura apertura a terceros requeriría gobierno de consumidores, contratos y controles adicionales.

Fuentes: [fase1 original](fuentes/fase1.txt), [requerimientos originales](fuentes/Fabrica_de_Credito_RF_RNF.txt), [decisiones adaptadas](fuentes/prompt-maestro.txt). Las discrepancias están en [REQUIREMENTS](REQUIREMENTS.md).
