import {
  ACCESS_TYPES,
  BUSINESS_CRITICALITY_LABELS,
  CHANGE_KINDS,
  DISPOSITIONS,
  EXCEPTION_CLASSES,
  EXCEPTION_KINDS,
  MILESTONE_PHASES,
  ROLLOUT_PRESET_IDS,
  PLAN_DATE_PRECISIONS,
  GO_NO_GO_DECISIONS,
  SITE_RAGS,
  ELEMENT_TYPE_NAMES,
  FOLDER_ROOTS,
  FONT_STYLES,
  HEX_COLOUR_PATTERN,
  INFLUENCE_STRENGTHS,
  JUNCTION_KINDS,
  LANGUAGE_TAG_PATTERN,
  LIFECYCLE_PHASES,
  RELATIONSHIP_TYPE_NAMES,
  SCHEMA_VERSION,
  TEXT_ALIGNMENTS,
  TEXT_POSITIONS,
  LABEL_POSITIONS,
  LEGEND_COLOURS,
  LEGEND_ROWS,
  LEGEND_SORTS,
  LEGEND_WIDTH_OFFSET,
  TIME_CLASSIFICATIONS,
  TYPE_SPECIFIC_ATTRIBUTES,
} from '@/model'

/**
 * The published JSON Schema for the canonical workspace format.
 *
 * Built from the metamodel rather than hand-written, so the type enumerations
 * cannot drift from `element-types.ts`. `design/archipelago-workspace.schema.json`
 * is the generated artifact — `npm run schema` rewrites it and a test fails if the
 * checked-in copy is stale.
 *
 * The schema matters beyond validation: concept §3.1 names AI agents as a
 * consumer of the model, and a published schema with stable ids is what lets one
 * maintain a workspace without reading our source.
 */

export const SCHEMA_ID =
  'https://stein-clankers.github.io/Enterprise-Architecture/schema/archipelago-workspace.schema.json'

export function buildWorkspaceJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCHEMA_ID,
    title: 'Archipelago workspace',
    description:
      'Canonical native format of an Archipelago workspace: an ArchiMate 3.2 model plus the portfolio profile overlay. Written with sorted keys and deterministic array order so that two exports of the same model are byte-identical.',
    type: 'object',
    required: ['schemaVersion', 'id', 'name', 'elements', 'relationships'],
    additionalProperties: false,
    properties: {
      schemaVersion: {
        type: 'integer',
        minimum: 1,
        description: `Format version. This build writes ${SCHEMA_VERSION}.`,
      },
      id: { type: 'string', minLength: 1 },
      name: { type: 'string' },
      documentation: {
        type: 'string',
        description:
          "What the model is for. The exchange format's model documentation, where Archi writes a model's purpose.",
      },
      elements: { type: 'array', items: { $ref: '#/$defs/element' } },
      relationships: { type: 'array', items: { $ref: '#/$defs/relationship' } },
      views: {
        type: 'array',
        description: 'Hand-drawn diagrams. (Schema 1 used this key for saved reports.)',
        items: { $ref: '#/$defs/view' },
      },
      folders: { type: 'array', items: { $ref: '#/$defs/folder' } },
      reports: {
        type: 'array',
        description: 'Saved report definitions.',
        items: { $ref: '#/$defs/report' },
      },
      tagGroups: { type: 'array', items: { $ref: '#/$defs/tagGroup' } },
      propertyTypes: {
        type: 'object',
        description:
          'Exchange-format types declared for property keys held here as text (currency, date, time), so a model that arrives typed leaves typed. Keys whose type the value itself carries (boolean, number) are not listed.',
        additionalProperties: { enum: ['boolean', 'currency', 'date', 'number', 'time'] },
      },
      language: {
        type: 'string',
        description:
          'The language the texts are written in, as an xml:lang tag. Absent means en. An exchange-format export labels every text with it.',
        pattern: LANGUAGE_TAG_PATTERN,
      },
    },
    $defs: {
      element: {
        type: 'object',
        required: ['id', 'type', 'name'],
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            description:
              'Stable identifier. Must be usable as an xs:ID so the model survives an exchange-format round trip.',
            pattern: '^[A-Za-z_][A-Za-z0-9_.-]*$',
          },
          type: { enum: [...ELEMENT_TYPE_NAMES] },
          name: { type: 'string' },
          documentation: { type: 'string' },
          junctionKind: {
            enum: [...JUNCTION_KINDS],
            description:
              'And/or flavour of a Junction, which the exchange format spells as two concrete types (AndJunction, OrJunction). Absent means "and". Meaningless on any other element type.',
          },
          properties: { $ref: '#/$defs/properties' },
          profile: { $ref: '#/$defs/portfolioProfile' },
          plan: { $ref: '#/$defs/plan' },
          folder: { $ref: '#/$defs/folderRef' },
        },
        allOf: [
          {
            if: { required: ['plan'] },
            then: { properties: { type: { const: 'WorkPackage' } } },
          },
        ],
      },
      ...planDefinitions(),
      relationship: {
        type: 'object',
        required: ['id', 'type', 'source', 'target'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1, pattern: '^[A-Za-z_][A-Za-z0-9_.-]*$' },
          type: { enum: [...RELATIONSHIP_TYPE_NAMES] },
          source: { type: 'string', description: 'id of the source element' },
          target: { type: 'string', description: 'id of the target element' },
          name: { type: 'string' },
          documentation: { type: 'string' },
          isDirected: {
            type: 'boolean',
            description:
              'Association only. true draws a half-arrowhead at the target; absent (or false) is undirected.',
          },
          modifier: {
            type: 'string',
            minLength: 1,
            description: `Influence only. The strength: ${INFLUENCE_STRENGTHS.join(', ')}, or any other text such as a number on a scale.`,
          },
          properties: { $ref: '#/$defs/properties' },
          profile: { $ref: '#/$defs/relationshipProfile' },
          folder: { $ref: '#/$defs/folderRef' },
        },
        allOf: [
          onlyOnType({ required: ['isDirected'] }, TYPE_SPECIFIC_ATTRIBUTES.isDirected),
          onlyOnType({ required: ['modifier'] }, TYPE_SPECIFIC_ATTRIBUTES.modifier),
          onlyOnType(
            { required: ['profile'], properties: { profile: { required: ['accessType'] } } },
            TYPE_SPECIFIC_ATTRIBUTES.accessType,
          ),
        ],
      },
      properties: {
        type: 'object',
        description: 'Free-form ArchiMate properties.',
        additionalProperties: { type: ['string', 'number', 'boolean'] },
      },
      portfolioProfile: {
        type: 'object',
        description:
          'LeanIX-style assessment overlay. Serialises as namespaced ArchiMate properties in the exchange format, so it survives a round trip through any certified tool.',
        additionalProperties: false,
        properties: {
          lifecycle: {
            type: 'object',
            description:
              'The date each phase starts, ISO 8601. The current phase is derived from these at a time point and is never stored.',
            additionalProperties: false,
            properties: Object.fromEntries(
              LIFECYCLE_PHASES.map((phase) => [
                phase,
                { type: 'string', format: 'date', examples: ['2027-01-01'] },
              ]),
            ),
          },
          functionalFit: { type: 'integer', minimum: 1, maximum: 4 },
          technicalFit: { type: 'integer', minimum: 1, maximum: 4 },
          businessCriticality: {
            type: 'integer',
            minimum: 1,
            maximum: 4,
            description: BUSINESS_CRITICALITY_LABELS.map((l, i) => `${i + 1} = ${l}`).join(', '),
          },
          timeClassification: { enum: [...TIME_CLASSIFICATIONS] },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      relationshipProfile: {
        type: 'object',
        description:
          'Fields carried by the relationship itself — cost, support type and validity dates belong on the edge, not on either endpoint.',
        additionalProperties: false,
        properties: {
          annualCost: { type: 'number', minimum: 0 },
          currency: { type: 'string' },
          supportType: { type: 'string' },
          validFrom: { type: 'string', format: 'date' },
          validTo: { type: 'string', format: 'date' },
          accessType: { enum: [...ACCESS_TYPES], description: 'Access relationships only.' },
        },
      },
      folderRef: {
        type: 'string',
        description:
          'id of the folder this object is filed in. Absent means the default group for its kind.',
      },
      folder: {
        type: 'object',
        description:
          'User organisation of the model tree; no semantics. Exactly one of parent and root is set.',
        required: ['id', 'name'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string' },
          documentation: { type: 'string' },
          parent: { type: 'string', description: 'id of the enclosing folder' },
          root: {
            enum: [...FOLDER_ROOTS],
            description: 'The fixed top-level group a top-level folder sits in.',
          },
        },
        oneOf: [{ required: ['parent'] }, { required: ['root'] }],
      },
      view: {
        type: 'object',
        description: 'A hand-drawn diagram.',
        required: ['id', 'name'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string' },
          documentation: { type: 'string' },
          viewpoint: { type: 'string', description: 'ArchiMate viewpoint name.' },
          router: {
            const: 'manhattan',
            description:
              'Connections drawn in horizontal and vertical segments, ignoring their bend-points. Absent means through the bend-points.',
          },
          folder: { $ref: '#/$defs/folderRef' },
          properties: { $ref: '#/$defs/properties' },
          nodes: { type: 'array', items: { $ref: '#/$defs/viewNode' } },
          connections: { type: 'array', items: { $ref: '#/$defs/viewConnection' } },
        },
      },
      bounds: {
        type: 'object',
        description: 'Position relative to the parent node (or the view), and size.',
        required: ['x', 'y', 'width', 'height'],
        additionalProperties: false,
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number', minimum: 0 },
          height: { type: 'number', minimum: 0 },
        },
      },
      appearance: {
        type: 'object',
        description: "Overrides of the notation's default look. Absent fields mean the default.",
        additionalProperties: false,
        properties: {
          fillColor: { $ref: '#/$defs/colour' },
          lineColor: { $ref: '#/$defs/colour' },
          lineWidth: { type: 'number', exclusiveMinimum: 0 },
          fontName: { type: 'string', minLength: 1 },
          fontSize: { type: 'number', exclusiveMinimum: 0 },
          fontColor: { $ref: '#/$defs/colour' },
          fontStyle: { type: 'array', items: { enum: [...FONT_STYLES] } },
          textAlignment: { enum: [...TEXT_ALIGNMENTS] },
          textPosition: { enum: [...TEXT_POSITIONS] },
          labelPosition: {
            enum: [...LABEL_POSITIONS],
            description: "Where a connection's label sits along it. Absent means the middle.",
          },
        },
      },
      colour: { type: 'string', pattern: HEX_COLOUR_PATTERN },
      viewNode: {
        type: 'object',
        description:
          'A diagram object: a drawn element, a note, a group, a view reference or a legend.',
        required: ['id', 'kind', 'bounds'],
        properties: {
          id: { type: 'string', minLength: 1, description: 'Unique within its view.' },
          kind: { enum: ['element', 'note', 'group', 'view-ref', 'legend'] },
          bounds: { $ref: '#/$defs/bounds' },
          parent: { type: 'string', description: 'id of the enclosing node in the same view' },
          appearance: { $ref: '#/$defs/appearance' },
          element: { type: 'string', description: "kind 'element': id of the element drawn" },
          text: { type: 'string', description: "kind 'note'" },
          name: {
            type: 'string',
            description: "kind 'group'; kind 'legend', which draws it nowhere",
          },
          documentation: { type: 'string', description: "kind 'group'" },
          view: { type: 'string', description: "kind 'view-ref': id of the view referenced" },
          options: { $ref: '#/$defs/legendOptions' },
        },
        additionalProperties: false,
        allOf: [
          requiredForKind('element', 'element'),
          requiredForKind('note', 'text'),
          requiredForKind('group', 'name'),
          requiredForKind('view-ref', 'view'),
          requiredForKind('legend', 'options'),
        ],
      },
      legendOptions: {
        type: 'object',
        description:
          "kind 'legend': what it lists and how, as Archi's ILegendOptions. Its entries are not stored; they follow the view.",
        required: [
          'elements',
          'relations',
          'specializedElements',
          'specializedRelations',
          'rowsPerColumn',
          'widthOffset',
          'colours',
          'sort',
        ],
        additionalProperties: false,
        properties: {
          elements: { type: 'boolean' },
          relations: { type: 'boolean' },
          specializedElements: { type: 'boolean' },
          specializedRelations: { type: 'boolean' },
          rowsPerColumn: { type: 'integer', minimum: LEGEND_ROWS.min, maximum: LEGEND_ROWS.max },
          widthOffset: {
            type: 'integer',
            minimum: LEGEND_WIDTH_OFFSET.min,
            maximum: LEGEND_WIDTH_OFFSET.max,
          },
          colours: { enum: [...LEGEND_COLOURS] },
          sort: { enum: [...LEGEND_SORTS] },
        },
      },
      viewConnection: {
        type: 'object',
        description: 'A drawn relationship, or a plain line between notes and groups.',
        required: ['id', 'kind', 'source', 'target'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1, description: 'Unique within its view.' },
          kind: { enum: ['relationship', 'line'] },
          source: { type: 'string', description: 'id of the source node' },
          target: { type: 'string', description: 'id of the target node' },
          bendpoints: {
            type: 'array',
            description: 'Route corners from source to target, in view coordinates.',
            items: {
              type: 'object',
              required: ['x', 'y'],
              additionalProperties: false,
              properties: { x: { type: 'number' }, y: { type: 'number' } },
            },
          },
          appearance: { $ref: '#/$defs/appearance' },
          relationship: {
            type: 'string',
            description: "kind 'relationship': id of the relationship drawn",
          },
          name: { type: 'string', description: "kind 'line'" },
        },
        allOf: [requiredForKind('relationship', 'relationship')],
      },
      report: {
        type: 'object',
        description: 'A saved report definition.',
        required: ['id', 'name', 'kind'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: {
            enum: ['graph', 'capability-map', 'landscape', 'matrix', 'roadmap', 'portfolio'],
          },
          baseType: { enum: [...ELEMENT_TYPE_NAMES] },
          filter: {
            type: 'object',
            properties: {
              facets: { type: 'array', items: { type: 'string' } },
              mode: { enum: ['AND', 'OR', 'NOT'] },
              query: { type: 'string' },
            },
          },
          cluster: { type: 'string' },
          drilldown: { type: 'string' },
          colorView: { enum: ['layer', 'lifecycle', 'time'] },
          timePoint: { type: 'integer' },
        },
      },
      tagGroup: {
        type: 'object',
        required: ['id', 'name', 'tags'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          multiSelect: { type: 'boolean' },
          tags: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                colourToken: {
                  type: 'string',
                  description: 'CSS custom property carrying the tag colour.',
                },
              },
            },
          },
        },
      },
    },
  }
}

/**
 * Rollouts, waves and site plans (#209, ADR 0013). Each object is closed
 * (`additionalProperties: false`), as the model's guards are strict.
 */
function planDefinitions(): Record<string, unknown> {
  const id = { type: 'string', minLength: 1 }
  const positive = { type: 'integer', minimum: 1 }
  const isoDay = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
  /** A change entry's own fields, which a template change adds its applicability to. */
  const entryProperties = {
    id,
    kind: { enum: [...CHANGE_KINDS] },
    subject: { ...id, description: 'id of the element or relationship it dates' },
    successor: {
      ...id,
      description: "kind 'replace': id of the element that replaces subject",
    },
    field: { enum: ['functionalFit', 'technicalFit', 'timeClassification'] },
    value: {
      description: "kind 'modify': the planned value of field",
      oneOf: [{ type: 'integer', minimum: 1, maximum: 4 }, { enum: [...TIME_CLASSIFICATIONS] }],
    },
    date: { oneOf: [{ $ref: '#/$defs/planDate' }, { $ref: '#/$defs/anchoredDate' }] },
  }
  const entryRules = [
    {
      if: { properties: { kind: { const: 'replace' } } },
      then: { required: ['successor'] },
      else: { not: { required: ['successor'] } },
    },
    {
      if: { properties: { kind: { const: 'modify' } } },
      then: { required: ['field', 'value'] },
      else: { not: { anyOf: [{ required: ['field'] }, { required: ['value'] }] } },
    },
  ]
  return {
    plan: {
      description:
        "A Work Package's plan profile: a rollout with its site plans, or one of its waves. Only a Work Package carries one.",
      oneOf: [{ $ref: '#/$defs/rolloutPlan' }, { $ref: '#/$defs/wavePlan' }],
    },
    planDate: {
      type: 'object',
      description:
        'A date with a precision. date is the first day of the period: of the quarter or month, the Monday of the ISO week, or the day itself.',
      required: ['date', 'precision'],
      additionalProperties: false,
      properties: { date: isoDay, precision: { enum: [...PLAN_DATE_PRECISIONS] } },
    },
    anchoredDate: {
      type: 'object',
      description: 'A milestone of the rollout plus whole days; negative is before it.',
      required: ['anchor', 'offsetDays'],
      additionalProperties: false,
      properties: { anchor: id, offsetDays: { type: 'integer' } },
    },
    rolloutPlan: {
      type: 'object',
      required: ['kind', 'templateVersion'],
      additionalProperties: false,
      properties: {
        kind: { const: 'rollout' },
        preset: {
          enum: [...ROLLOUT_PRESET_IDS],
          description: 'The preset the rollout was made from, for the checks it adds.',
        },
        templateVersion: positive,
        milestones: {
          type: 'array',
          description: 'Ordered: the site phase is derived walking them in this order.',
          items: { $ref: '#/$defs/milestone' },
        },
        template: {
          type: 'array',
          description: 'The scope template: change entries written relative to a site, in order.',
          items: { $ref: '#/$defs/templateChange' },
        },
        constraints: {
          type: 'object',
          additionalProperties: false,
          properties: {
            blackouts: { type: 'array', items: { $ref: '#/$defs/blackout' } },
            defaultCapacity: positive,
          },
        },
        archetypes: { type: 'array', items: { $ref: '#/$defs/archetype' } },
        sites: {
          type: 'array',
          description: 'One plan per Location, sorted by location id.',
          items: { $ref: '#/$defs/sitePlan' },
        },
      },
    },
    wavePlan: {
      type: 'object',
      required: ['kind', 'rollout', 'label', 'order', 'templateVersion'],
      additionalProperties: false,
      properties: {
        kind: { const: 'wave' },
        rollout: { ...id, description: 'id of the rollout Work Package that aggregates the wave' },
        label: { type: 'string' },
        order: { type: 'integer' },
        window: {
          type: 'object',
          additionalProperties: false,
          properties: { start: { $ref: '#/$defs/planDate' }, end: { $ref: '#/$defs/planDate' } },
        },
        capacity: { ...positive, description: 'Maximum number of sites.' },
        templateVersion: {
          ...positive,
          description: 'The template version the wave is locked to.',
        },
        milestones: {
          type: 'object',
          description:
            "The dates the wave's sites inherit when they set none of their own, by milestone id.",
          additionalProperties: { $ref: '#/$defs/planDate' },
        },
      },
    },
    milestone: {
      type: 'object',
      required: ['id', 'label', 'startsPhase'],
      additionalProperties: false,
      properties: {
        id,
        label: { type: 'string' },
        startsPhase: { enum: [...MILESTONE_PHASES] },
        date: {
          $ref: '#/$defs/planDate',
          description:
            "The rollout's own date for the milestone, which a site inherits when neither it nor its wave sets one.",
        },
      },
    },
    changeEntry: {
      type: 'object',
      description:
        "A change entry (ADR 0014): it dates something in the model. A site's own change, in an 'add' exception.",
      required: ['id', 'kind', 'subject', 'date'],
      additionalProperties: false,
      properties: entryProperties,
      allOf: entryRules,
    },
    templateChange: {
      type: 'object',
      description:
        'A change entry (ADR 0014): it dates something in the model, here relative to each site it applies to.',
      required: ['id', 'kind', 'subject', 'date', 'applicability'],
      additionalProperties: false,
      properties: {
        ...entryProperties,
        applicability: {
          oneOf: [
            {
              type: 'object',
              required: ['kind'],
              additionalProperties: false,
              properties: { kind: { const: 'all' } },
            },
            {
              type: 'object',
              required: ['kind', 'archetypes'],
              additionalProperties: false,
              properties: {
                kind: { const: 'archetypes' },
                archetypes: { type: 'array', minItems: 1, uniqueItems: true, items: id },
              },
            },
            {
              type: 'object',
              required: ['kind', 'element'],
              additionalProperties: false,
              properties: { kind: { const: 'aggregating' }, element: id },
            },
          ],
        },
      },
      allOf: entryRules,
    },
    archetype: {
      type: 'object',
      required: ['id', 'label'],
      additionalProperties: false,
      properties: {
        id,
        label: { type: 'string' },
        durations: {
          type: 'object',
          description: 'Default days from the previous milestone, by milestone id.',
          additionalProperties: { type: 'integer', minimum: 0 },
        },
      },
    },
    blackout: {
      type: 'object',
      description: 'A period no cutover should fall in, both days inclusive.',
      required: ['id', 'start', 'end'],
      additionalProperties: false,
      properties: { id, label: { type: 'string' }, start: isoDay, end: isoDay },
    },
    sitePlan: {
      type: 'object',
      description: "One Location's plan within its rollout.",
      required: ['location'],
      additionalProperties: false,
      properties: {
        location: { ...id, description: 'id of the Location element' },
        wave: { ...id, description: 'id of a wave of the same rollout; absent is unassigned' },
        archetype: { ...id, description: 'id of an archetype of the rollout' },
        milestones: {
          type: 'object',
          description: 'Planned dates that override the inherited ones, by milestone id.',
          additionalProperties: { $ref: '#/$defs/planDate' },
        },
        actuals: {
          type: 'object',
          description: 'The day each milestone was actually reached, by milestone id.',
          additionalProperties: isoDay,
        },
        rag: { enum: [...SITE_RAGS] },
        goNoGo: {
          enum: [...GO_NO_GO_DECISIONS],
          description: 'The decision taken at the go/no-go gate; absent is not decided yet.',
        },
        notes: { type: 'string', minLength: 1 },
        exceptions: {
          type: 'array',
          description:
            'Its deviations from the template, sorted by id; ids are unique in the rollout.',
          items: { $ref: '#/$defs/siteException' },
        },
        dependsOn: {
          type: 'array',
          description:
            'Location ids of the sites of the same rollout that cut over before it, sorted.',
          uniqueItems: true,
          items: id,
        },
        blackouts: {
          type: 'array',
          description: "Its own blackouts, besides the rollout's, sorted by id.",
          items: { $ref: '#/$defs/blackout' },
        },
      },
    },
    siteException: {
      type: 'object',
      description:
        "A site's deviation from the template: 'skip' a template change, 'modify' its offset or disposition, or 'add' a change of the site's own.",
      required: ['id', 'kind', 'change', 'class'],
      additionalProperties: false,
      properties: {
        id,
        kind: { enum: [...EXCEPTION_KINDS] },
        change: {
          description:
            "kinds 'skip' and 'modify': the id of a template change; kind 'add': the site's own change entry",
          oneOf: [id, { $ref: '#/$defs/changeEntry' }],
        },
        class: { enum: [...EXCEPTION_CLASSES] },
        owner: { type: 'string' },
        expires: { ...isoDay, description: 'The last day it holds.' },
        rationale: { type: 'string' },
        offsetDays: {
          type: 'integer',
          description: "kind 'modify': whole days from the change's anchor at this site",
        },
        disposition: {
          enum: [...DISPOSITIONS],
          description: "kind 'modify': what becomes of the data at this site",
        },
      },
      allOf: [
        {
          if: { properties: { kind: { const: 'add' } } },
          then: { properties: { change: { $ref: '#/$defs/changeEntry' } } },
          else: { properties: { change: id } },
        },
        {
          if: { properties: { kind: { const: 'modify' } } },
          then: { anyOf: [{ required: ['offsetDays'] }, { required: ['disposition'] }] },
          else: { not: { anyOf: [{ required: ['offsetDays'] }, { required: ['disposition'] }] } },
        },
      ],
    },
  }
}

/** "When `kind` is `kind`, `field` is required." */
function requiredForKind(kind: string, field: string): Record<string, unknown> {
  return { if: { properties: { kind: { const: kind } } }, then: { required: [field] } }
}

/** A relationship matching `carries` must be of `type` (#84). */
function onlyOnType(carries: Record<string, unknown>, type: string): Record<string, unknown> {
  return { if: carries, then: { properties: { type: { const: type } } } }
}

/** The schema as it is written to disk. */
export function workspaceJsonSchemaText(): string {
  return `${JSON.stringify(buildWorkspaceJsonSchema(), null, 2)}\n`
}
