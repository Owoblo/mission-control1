const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict')
const source = ts.createSourceFile('automation.ts', fs.readFileSync('lib/server/sales-automation.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reconcileNurtureLeads')
assert.ok(declaration)
const policy = require('../../.tmp-logic-tests/lib/nurture-policy.js')
const { generateConditionTasks } = require('../../.tmp-logic-tests/lib/server/task-generation.js')
const base = { name: 'Fixture', stage: 'nurture', createdAt: '2026-09-01T12:00:00Z', assignedRepUserId: 'rep1', followUpDate: '2026-10-02' }
const records = new Map([
 ['near', { ...base, id: 'near', moveDate: '2026-11-01' }],
 ['later', { ...base, id: 'later', moveDate: '2027-02-01' }],
 ['lost', { ...base, id: 'lost', moveDate: '2026-10-04', stage: 'lost' }],
 ['custom', { ...base, id: 'custom', moveDate: '2026-12-01', nurtureReturnWindowDays: 60 }],
])
const logs = [], tasks = [], exportsObject = {}
const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(code, { exports: exportsObject, ...policy, Date, crypto: require('node:crypto').webcrypto,
 listSalesLeads: async () => [...records.values()].map(lead => structuredClone(lead)),
 getSalesLeadForUpdate: async id => ({ lead: structuredClone(records.get(id)), updatedAt: 'version1' }),
 saveSalesLead: async (lead, version) => { assert.equal(version, 'version1'); records.set(lead.id, JSON.parse(JSON.stringify(lead))); return records.get(lead.id) },
 saveFollowUpLog: async log => { logs.push(log) }, uid: () => crypto.randomUUID(), generateConditionTasks,
 saveGeneratedTasks: async next => { tasks.push(...next) },
})
;(async () => {
 const returned = await exportsObject.reconcileNurtureLeads(new Date('2026-10-02T16:00:00Z'))
 assert.deepEqual(Array.from(returned, lead => lead.id), ['near', 'custom'])
 assert.equal(records.get('near').stage, 'contacted')
 assert.equal(records.get('near').followUpDate, '2026-10-02')
 assert.equal(records.get('near').stageHistory[0].source, 'system')
 assert.equal(records.get('lost').stage, 'lost')
 assert.equal(records.get('later').stage, 'nurture')
 assert.equal(tasks.length, 1); assert.equal(tasks[0].relatedId, 'later'); assert.equal(tasks[0].ownerUserId, 'rep1')
 await exportsObject.reconcileNurtureLeads(new Date('2026-10-02T16:02:00Z'))
 assert.equal(logs.length, 2, 'Repeated worker runs must not repeat the transition')
 console.log(JSON.stringify({automaticReturn:true,customWindow:true,assignedReminder:true,lostUnchanged:true,idempotent:true,database:'mocked repository'}))
})().catch(error => {console.error(error);process.exitCode=1})
