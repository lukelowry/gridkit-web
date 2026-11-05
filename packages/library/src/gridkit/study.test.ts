import { describe, expect, it } from 'vitest';
import { CaseDocument } from '../document.js';
import { parseCase } from '../case.js';
import ieee39 from '../../../../library/IEEE39.case.json';
import wecc240 from '../../../../library/WECC240.case.json';
import { actionTime, defaultStudy, faultable, importStudy, studyIssues, studyTargets, switchable, withEvent } from './index.js';

it('schedules an action at 1 s, or two steps in where steps are longer, never past half the run', () => {
  expect(actionTime(defaultStudy())).toBe(1);
  expect(actionTime({ ...defaultStudy(), tmax: 1 })).toBe(0.5);
  expect(actionTime({ tmax: 100, dt_monitor: 5 })).toBe(10);
  expect(actionTime({ tmax: 100, dt_monitor: 0.1, dt_fixed: 2 })).toBe(4);
});

describe.each([ieee39, wecc240])('$header.case_name study settings', fixture => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture)));
  const targets = studyTargets(document);
  it('schedules a matched bus fault without changing the source study or case', () => {
    const original = defaultStudy(), bus = document.rows('buses').find(faultable)!;
    const next = withEvent(original, 'fault_on', bus);
    expect(original.events).toEqual([]);
    expect(next.events).toEqual([
      {type:'fault_on',time:1,bus:bus.value.number,R:0,X:0.01},
      {type:'fault_off',time:1.15,bus:bus.value.number},
    ]);
    expect(studyIssues(next, targets)).toEqual([]);
    next.events![0]!.time = 20;
    expect(studyIssues(next, targets)).toContainEqual({ path: ['events', 0, 'time'], message: 'Time exceeds the simulation duration.' });
  });
  it('uses native branch IDs and rejects nonexistent or unsupported targets', () => {
    const branch = document.rows('devices').find(switchable)!;
    const next = withEvent(defaultStudy(), 'out_of_service', branch);
    expect(next.events![0]).toMatchObject({device:branch.value.id,type:'out_of_service'});
    expect(studyIssues(next, targets)).toEqual([]);
    next.events = [{type:'fault_on',bus:987654321,time:1,R:0,X:0}];
    expect(studyIssues(next, targets)).toEqual([
      { path: ['events', 0, 'bus'], message: 'Choose an existing bus that supports faults.' },
      { path: ['events', 0, 'impedance'], message: 'Resistance and reactance cannot both be zero.' },
    ]);
  });
});

it('round-trips explicit solver overrides, preserves omitted defaults, and rejects unknown settings', () => {
  const value = {...defaultStudy(),rel_tol:1e-7,abs_tol:1e-9,dt_fixed:0,max_steps:0,max_order:5,consistent_ic_type:'ya_ydp'};
  expect(importStudy(JSON.stringify({system_model_file:'IEEE39.case.json',output_file:'result.csv',...value}))).toEqual(value);
  expect(importStudy(JSON.stringify(defaultStudy()))).not.toHaveProperty('rel_tol');
  expect(() => importStudy(JSON.stringify({...value,reference_file:'missing.csv'}))).toThrow('reference_file');
  expect(studyIssues({...value,rel_tol:0})).not.toEqual([]);
  expect(studyIssues({...value,dt_fixed:0.001})).toContainEqual({ path: ['max_order'], message: 'Fixed stepping supports a maximum order of 2. Clear the order to use the solver default.' });
});
it('leaves a blank optional setting to the solver and asks for a blank required one', () => {
  expect(studyIssues({...defaultStudy(),max_steps:undefined})).toEqual([]);
  expect(studyIssues({...defaultStudy(),tmax:null})).toEqual([{ path: ['tmax'], message: 'Enter a value.' }]);
});
