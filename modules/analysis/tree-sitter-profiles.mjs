// Grammar-specific extraction rules share one traversal and record contract.
// Names are syntax, never evidence that a same-named target is the binding.
const field = (node, name) => node.childForFieldName(name);
const child = (node, ...types) => node.namedChildren.find(n => types.includes(n.type));
const named = node => field(node, 'name');
const declarator = node => {
  let name = field(node, 'declarator');
  while (name && field(name, 'declarator')) name = field(name, 'declarator');
  return name;
};
const firstName = node => named(node) ?? child(node, 'simple_identifier', 'type_identifier', 'identifier');
const rules = (types, kind, name = named) => Object.fromEntries(types.split(' ').map(type => [type, { kind, name }]));
const c = { declarations: { ...rules('function_definition', 'function', declarator), ...rules('struct_specifier union_specifier', 'class'), ...rules('enum_specifier', 'enum') },
  calls: { call_expression: node => field(node, 'function') }, imports: { preproc_include: node => field(node, 'path') } };
const java = { declarations: { ...rules('class_declaration record_declaration', 'class'), ...rules('interface_declaration', 'interface'), ...rules('enum_declaration', 'enum'), ...rules('method_declaration constructor_declaration', 'method') },
  calls: { method_invocation: node => ({ name: [field(node, 'object')?.text, named(node)?.text].filter(Boolean).join('.'), node }), object_creation_expression: node => ({ node, name: field(node, 'type')?.text, kind: 'construct' }) },
  imports: { import_declaration: node => node } };
const objc = { declarations: { ...c.declarations, ...rules('class_interface class_implementation protocol_declaration', 'class', node => child(node, 'identifier')), ...rules('method_definition method_declaration', 'method', node => child(node, 'identifier')) },
  calls: { ...c.calls, message_expression: node => ({ node, name: node.text }) }, imports: c.imports };
export const treeSitterProfiles = {
  python: { declarations: { ...rules('function_definition', 'function'), ...rules('class_definition', 'class') }, calls: { call: node => field(node, 'function') }, imports: { import_statement: node => node, import_from_statement: node => node } },
  java,
  kotlin: { declarations: { ...rules('function_declaration', 'function', firstName), ...rules('class_declaration object_declaration', 'class', firstName), ...rules('type_alias', 'type-alias', firstName) }, calls: { call_expression: node => node.namedChildren[0] }, imports: { import_header: node => node } },
  go: { declarations: { ...rules('function_declaration', 'function'), ...rules('method_declaration', 'method'), ...rules('type_spec', 'type-alias') }, calls: { call_expression: node => field(node, 'function') }, imports: { import_spec: node => field(node, 'path') } },
  'objective-c': objc, 'objective-c++': objc,
  sql: { declarations: { ...rules('create_table create_view', 'table', node => child(node, 'object_reference')) }, calls: { invocation: node => child(node, 'object_reference') }, imports: {} },
  json: { declarations: { ...rules('pair', 'property', node => field(node, 'key')) }, calls: {}, imports: {} },
  shell: { declarations: rules('function_definition', 'function'), calls: { command: node => field(node, 'name') }, imports: {} },
  c,
  cpp: { ...c, declarations: { ...c.declarations, ...rules('class_specifier', 'class'), ...rules('namespace_definition', 'namespace') } },
  csharp: { declarations: { ...java.declarations, ...rules('struct_declaration', 'class'), ...rules('namespace_declaration file_scoped_namespace_declaration', 'namespace') }, calls: { invocation_expression: node => field(node, 'function'), object_creation_expression: java.calls.object_creation_expression }, imports: { using_directive: node => node } },
  rust: { declarations: { ...rules('function_item', 'function'), ...rules('struct_item', 'class'), ...rules('trait_item', 'interface'), ...rules('enum_item', 'enum'), ...rules('mod_item', 'namespace'), ...rules('type_item', 'type-alias') }, calls: { call_expression: node => field(node, 'function') }, imports: { use_declaration: node => node } },
  ruby: { declarations: { ...rules('method singleton_method', 'method'), ...rules('class', 'class'), ...rules('module', 'namespace') }, calls: { call: node => ({ node, name: [field(node, 'receiver')?.text, field(node, 'method')?.text].filter(Boolean).join('.') }) }, imports: {} },
  swift: { declarations: { ...rules('function_declaration', 'function', firstName), ...rules('class_declaration protocol_declaration', 'class', firstName) }, calls: { call_expression: node => node.namedChildren[0] }, imports: { import_declaration: node => node } },
};
