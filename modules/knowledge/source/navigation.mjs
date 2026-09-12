import { validateSourceSnapshot } from './model.mjs';
import { fail } from '../shared/model.mjs';

export const sourceModuleKinds = ['import', 're-export', 'dynamic-import', 'require'];
export const sourceCallableKinds = ['function', 'method'];

// A projection of source facts. Containers describe lexical ownership, never
// architectural responsibility or proof that a function invokes another.
export function sourceNavigation(snapshot) {
  const result = validateSourceSnapshot(snapshot);
  if (!result.ok) fail('Invalid source snapshot.', result.diagnostics);
  const declarations = new Map(snapshot.declarations.map(d => [d.id, d]));
  const caller = ref => {
    let owner = declarations.get(ref.containerRef);
    while (owner && !sourceCallableKinds.includes(owner.kind)) owner = declarations.get(owner.containerRef);
    return owner?.id ?? ref.fileRef;
  };
  const relationships = snapshot.references.filter(r => sourceModuleKinds.includes(r.kind) || ['call', 'construct'].includes(r.kind)).map(reference => ({
    reference, callerRef: caller(reference),
    provenance: reference.resolution.targets.flatMap(id => {
      const binding = declarations.get(id);
      return binding?.valueProvenance ? [{ bindingRef: id, ...binding.valueProvenance }] : [];
    }),
  }));
  return { snapshotId: snapshot.id, source: structuredClone(snapshot.source), coverage: structuredClone(snapshot.coverage),
    files: structuredClone(snapshot.files), declarations: structuredClone(snapshot.declarations), relationships: structuredClone(relationships),
    diagnostics: structuredClone(snapshot.diagnostics), limitations: [...snapshot.limitations],
    semantics: 'Source syntax, compiler bindings and static value provenance. These are not runtime dispatch or execution guarantees. Unresolved and candidate relationships remain qualified.' };
}
