"""Contract-first baseline. Generated JSON is reviewed/versioned before route implementation."""
import json
from pathlib import Path

def obj(properties, required=None, **extra):
    required = list(properties) if required is None else required
    return {'type': 'object', 'additionalProperties': False, 'properties': properties, **({'required': required} if required else {}), **extra}
def string(**kw): return {'type':'string', **kw}
def integer(lo=0, hi=100_000_000): return {'type':'integer','minimum':lo,'maximum':hi}
def ref(name): return {'$ref': '#/components/schemas/'+name}
def array(items, **kw): return {'type':'array','items':items, **kw}
banks=['pichincha','pacifico']
states=['ENVIADA','OFERTAS','SIN_OFERTAS','ACEPTADA','DESISTIDA']
scenarios=['aprobada','condiciones','rechazada','informacion','demora','temporal','timeout']
text=string(minLength=1,maxLength=120)
uuid=string(format='uuid')
money=integer(0)
schemas={
 'Problem':obj({'type':string(),'title':string(),'status':integer(400,599),'detail':string(),'instance':string(),'correlationId':string()}),
 'Login':obj({'email':string(format='email',maxLength=120),'password':string(minLength=12,maxLength=128)}),
 'Actor':obj({'sub':text,'role':string(enum=['asesor','supervisor','administrador']),'agency':text,'name':text}),
 'Session':obj({'token':string(),'user':ref('Actor'),'expiresIn':integer(1,3600)}),
 'Client':obj({'name':string(minLength=3,maxLength=100),'email':string(format='email',maxLength=120),'identification':string(pattern='^DEMO-[0-9]{6}$'),'incomeCents':integer(10000,100_000_000)}),
 'Vehicle':obj({'brand':text,'model':text,'year':integer(2000,2030),'priceCents':integer(100_000,20_000_000)}),
 'Financing':obj({'downPaymentCents':money,'termMonths':{'type':'integer','enum':[12,24,36,48,60,72]}}),
 'Consent':obj({'accepted':{'type':'boolean','enum':[True]},'channel':string(enum=['web','agencia']),'evidence':string(minLength=10,maxLength=500)}),
 'ApplicationInput':obj({'client':ref('Client'),'vehicle':ref('Vehicle'),'financing':ref('Financing'),'consent':ref('Consent'),'banks':array(string(enum=banks),minItems=1,maxItems=2,uniqueItems=True),'scenario':string(enum=scenarios)}),
 'Offer':obj({'id':uuid,'bank':string(enum=banks),'annualRate':{'type':'number','minimum':0,'maximum':100},'termMonths':integer(12,72),'installmentCents':money,'downPaymentCents':money,'insuranceCents':money,'conditions':array(string(maxLength=200),maxItems=10)}),
 'Audit':obj({'at':string(format='date-time'),'actor':string(),'action':string(),'correlationId':string()}),
 'Submission':obj({'state':string(enum=['PENDIENTE','EN_ANALISIS','APROBADA','CONDICIONES','RECHAZADA','INFORMACION','ERROR']),'externalId':string(),'offer':ref('Offer'),'jobState':string(enum=['pending','leased','done','dead'])},['state','jobState']),
 'Application':obj({'id':uuid,'agency':string(),'state':string(enum=states),'version':integer(1),'createdAt':string(format='date-time'),'client':ref('Client'),'vehicle':ref('Vehicle'),'financing':ref('Financing'),'banks':array(string(enum=banks)),'scenario':string(enum=scenarios),'submissions':obj({b:ref('Submission') for b in banks},[]),'audit':array(ref('Audit')),'acceptedOfferId':uuid},['id','agency','state','version','createdAt','client','vehicle','financing','banks','scenario','submissions','audit']),
 'Page':obj({'items':array(ref('Application')),'page':integer(1,10000),'size':integer(1,100),'total':integer()}),
 'BankResult':obj({'eventId':uuid,'applicationId':uuid,'bank':string(enum=banks),'externalId':string(minLength=1,maxLength=120),'decision':string(enum=['APROBADA','CONDICIONES','RECHAZADA','INFORMACION']),'offer':ref('Offer')},['eventId','applicationId','bank','externalId','decision']),
 'Ack':obj({'accepted':{'type':'boolean'}}),
 'Health':obj({'status':string(enum=['ok'])}),
 'Bank':obj({'id':string(enum=banks),'name':string(),'protocol':string(),'academic':{'type':'boolean'}}),
 'Metrics':obj({'requests':integer(),'failures':integer(),'uptimeSeconds':{'type':'number'},'memoryRssBytes':integer(0,10**13),'cpuUserMicros':integer(0,10**15),'cpuSystemMicros':integer(0,10**15),'queuePending':integer(),'queueDead':integer()})
}
example={'client':{'name':'Cliente Ficticio Uno','email':'cliente@example.test','identification':'DEMO-000001','incomeCents':250000},'vehicle':{'brand':'Marca Demo','model':'Modelo Uno','year':2026,'priceCents':3000000},'financing':{'downPaymentCents':900000,'termMonths':48},'consent':{'accepted':True,'channel':'web','evidence':'Consentimiento ficticio registrado para demostración académica'},'banks':banks,'scenario':'aprobada'}
def param(name, where, schema, required=True): return {'name':name,'in':where,'required':required,'schema':schema}
idparam=param('id','path',uuid)
keyparam=param('Idempotency-Key','header',string(minLength=8,maxLength=100,pattern='^[A-Za-z0-9_-]+$'))
etag=param('If-Match','header',string(pattern='^"[0-9]+"$'))
def response(schema,description='Operación completada',headers=False):
    r={'description':description,'content':{'application/json':{'schema':schema}}}
    if headers: r['headers']={'ETag':{'schema':string(),'description':'Versión entre comillas para If-Match'},'X-Correlation-ID':{'schema':string(),'description':'Identificador de trazabilidad'},'Location':{'schema':string(),'description':'Recurso creado'}}
    return r
def operation(name,tag,out=None,code='200',body=None,params=None,public=False):
    r={'operationId':name,'summary':name,'tags':[tag],'security':[] if public else [{'bearerAuth':[]}], 'responses':{code:response(out or ref('Ack'),headers=out==ref('Application')),'default':{'description':'Error normalizado; 400 validación, 401 autenticación, 403 rol, 404 alcance, 409 conflicto, 412 versión, 413 tamaño, 415 formato, 422 regla, 429 límite, 503 dependencia','content':{'application/problem+json':{'schema':ref('Problem')}}}}}
    if params: r['parameters']=params
    if body:
        r['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
        if body=='ApplicationInput': r['requestBody']['content']['application/json']['example']=example
    return r
paths={
 '/health/live':{'get':operation('Liveness','Sistema',ref('Health'),public=True)},
 '/health/ready':{'get':operation('Readiness','Sistema',ref('Health'),public=True)},
 '/v1/auth/login':{'post':operation('IniciarSesion','Acceso',ref('Session'),body='Login',public=True)},
 '/v1/auth/me':{'get':operation('ConsultarSesion','Acceso',ref('Actor'))},
 '/v1/financieras':{'get':operation('ListarFinancieras','Financieras',array(ref('Bank')))},
 '/v1/solicitudes':{'post':operation('CrearYEnviar','Solicitudes',ref('Application'),'202','ApplicationInput',[keyparam]),'get':operation('ListarSolicitudes','Solicitudes',ref('Page'),params=[param('page','query',integer(1,10000),False),param('size','query',integer(1,100),False),param('state','query',string(enum=states),False),param('bank','query',string(enum=banks),False),param('sort','query',string(enum=['asc','desc']),False)])},
 '/v1/solicitudes/{id}':{'get':operation('ConsultarSolicitud','Solicitudes',ref('Application'),params=[idparam,param('If-None-Match','header',string(),False)])},
 '/v1/solicitudes/{id}/respuestas':{'get':operation('ConsultarRespuestas','Solicitudes',obj({b:ref('Submission') for b in banks},[]),params=[idparam])},
 '/v1/solicitudes/{id}/ofertas':{'get':operation('CompararOfertas','Solicitudes',array(ref('Offer')),params=[idparam])},
 '/v1/solicitudes/{id}/eventos':{'get':operation('ConsultarBitacora','Solicitudes',array(ref('Audit')),params=[idparam])},
 '/v1/solicitudes/{id}/ofertas/{offerId}/aceptar':{'post':operation('AceptarOferta','Solicitudes',ref('Application'),params=[idparam,param('offerId','path',uuid),keyparam,etag])},
 '/v1/solicitudes/{id}/desistir':{'post':operation('Desistir','Solicitudes',ref('Application'),params=[idparam,keyparam,etag])},
 '/v1/webhooks/financieras/{bank}':{'post':operation('RecibirRespuesta','Integraciones',ref('Ack'),body='BankResult',params=[param('bank','path',string(enum=['pichincha'])),param('X-Timestamp','header',string(pattern='^[0-9]{13}$')),param('X-Signature','header',string(pattern='^[a-f0-9]{64}$'))],public=True)},
 '/v1/admin/solicitudes/{id}/reintentar':{'post':operation('ReintentarDLQ','Administración',ref('Application'),params=[idparam])},
 '/v1/admin/metrics':{'get':operation('ConsultarMetricas','Administración',ref('Metrics'))},
}
paths['/v1/solicitudes/{id}']['get']['responses']['304']={'description':'Sin cambios; cuerpo vacío'}
paths['/v1/webhooks/financieras/{bank}']['post']['security']=[{'webhookSignature':[]}]
contract={'openapi':'3.0.3','info':{'title':'Fábrica de Crédito Vehicular — sandbox académico','version':'1.0.0','description':'Datos exclusivamente ficticios. JWT propio; no OAuth. Importes enteros en centavos USD. Las financieras son simulaciones sin relación con sus APIs reales. No existen URLs de nube verificadas.'},'servers':[{'url':'/','description':'Mismo origen que la API (local, túnel SSH o proxy HTTPS)'}],'tags':[{'name':n} for n in ['Sistema','Acceso','Financieras','Solicitudes','Integraciones','Administración']],'paths':paths,'components':{'securitySchemes':{'bearerAuth':{'type':'http','scheme':'bearer','bearerFormat':'JWT'},'webhookSignature':{'type':'apiKey','in':'header','name':'X-Signature','description':'HMAC-SHA256(secret, timestamp + punto + cuerpo JSON exacto), X-Timestamp milisegundos, ventana 5 min. Evento deduplicado.'}},'schemas':schemas}}
Path('shared/openapi.json').write_text(json.dumps(contract,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
Path('shared/example.json').write_text(json.dumps(example,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
