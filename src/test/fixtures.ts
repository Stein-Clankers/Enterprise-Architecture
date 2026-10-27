import {
  SCHEMA_VERSION,
  DEFAULT_TAG_GROUP,
  drawingOrder,
  type Element,
  type Folder,
  type Relationship,
  type View,
  type Workspace,
} from '@/model'

/** A tiny hand-written model, ArchiSurance-flavoured, for behavioural tests. */
export function smallWorkspace(): Workspace {
  const elements: Element[] = [
    {
      id: 'cap-claim',
      type: 'Capability',
      name: 'Claim Handling',
      documentation: 'Intake, assessment, settlement and recovery of claims.',
      properties: { owner: 'Claims' },
      profile: { tags: ['Core'] },
    },
    {
      id: 'proc-claim',
      type: 'BusinessProcess',
      name: 'Handle Claim',
      properties: { owner: 'Claims' },
    },
    {
      id: 'app-claims',
      type: 'ApplicationComponent',
      name: 'Claim Handling Engine',
      documentation: 'New rules-driven claim assessment platform.',
      properties: { owner: 'Claims' },
      profile: {
        lifecycle: {
          plan: '2024-01-01',
          phaseIn: '2025-01-01',
          active: '2027-01-01',
          phaseOut: '2033-01-01',
          endOfLife: '2034-01-01',
        },
        functionalFit: 4,
        technicalFit: 4,
        businessCriticality: 4,
        timeClassification: 'Invest',
        tags: ['Core', 'Cloud target'],
      },
    },
    {
      id: 'obj-claim',
      type: 'DataObject',
      name: 'Claim Record',
      properties: {},
    },
    {
      id: 'tec-k8s',
      type: 'Node',
      name: 'Kubernetes Platform',
      properties: { owner: 'Platform Ops' },
    },
  ]

  const relationships: Relationship[] = [
    {
      id: 'rel-proc-cap',
      type: 'Realization',
      source: 'proc-claim',
      target: 'cap-claim',
      properties: {},
    },
    {
      id: 'rel-app-proc',
      type: 'Serving',
      source: 'app-claims',
      target: 'proc-claim',
      documentation: 'Every claim is registered and assessed in the Claims Engine.',
      properties: {},
      profile: { annualCost: 1_200_000, currency: 'EUR' },
    },
    {
      id: 'rel-app-obj',
      type: 'Access',
      source: 'app-claims',
      target: 'obj-claim',
      properties: {},
      profile: { accessType: 'ReadWrite' },
    },
    {
      id: 'rel-k8s-app',
      type: 'Serving',
      source: 'tec-k8s',
      target: 'app-claims',
      properties: {},
    },
  ]

  return {
    id: 'ws-test',
    name: 'ArchiSurance',
    documentation: 'A small insurance landscape for tests.',
    schemaVersion: SCHEMA_VERSION,
    elements,
    relationships,
    views: [],
    folders: [],
    reports: [],
    tagGroups: [DEFAULT_TAG_GROUP],
  }
}

/**
 * A synthetic workspace of `size` elements with roughly two relationships each —
 * the 5,000-element scale the brief and issue #4 call out.
 *
 * Deterministic: no randomness, so a slow run is a real regression rather than an
 * unlucky shuffle.
 */
const TIME_CYCLE = ['Tolerate', 'Invest', 'Migrate', 'Eliminate'] as const

export function syntheticWorkspace(size: number, id = 'ws-synthetic'): Workspace {
  const elements: Element[] = []
  const relationships: Relationship[] = []

  const capabilityCount = Math.max(1, Math.floor(size / 50))
  for (let i = 0; i < capabilityCount; i += 1) {
    elements.push({
      id: `cap-${i}`,
      type: 'Capability',
      name: `Capability ${i}`,
      properties: { owner: `BU ${i % 7}` },
    })
  }

  const appCount = size - capabilityCount
  for (let i = 0; i < appCount; i += 1) {
    const year = 2000 + (i % 20)
    elements.push({
      id: `app-${i}`,
      type: 'ApplicationComponent',
      name: `Application ${i}`,
      ...(i % 3 === 0 ? { documentation: `Synthetic application ${i}.` } : {}),
      properties: i % 2 === 0 ? { owner: `BU ${i % 7}` } : {},
      profile: {
        lifecycle: {
          plan: `${year}-01-01`,
          phaseIn: `${year + 1}-01-01`,
          active: `${year + 2}-01-01`,
          phaseOut: `${year + 18}-01-01`,
          endOfLife: `${year + 20}-01-01`,
        },
        functionalFit: ((i % 4) + 1) as 1 | 2 | 3 | 4,
        technicalFit: (((i + 2) % 4) + 1) as 1 | 2 | 3 | 4,
        businessCriticality: (((i + 1) % 4) + 1) as 1 | 2 | 3 | 4,
        timeClassification: TIME_CYCLE[i % TIME_CYCLE.length] ?? 'Tolerate',
        tags: i % 5 === 0 ? ['Core'] : [],
      },
    })

    // Each application realizes a capability and serves the next application.
    relationships.push({
      id: `rel-cap-${i}`,
      type: 'Realization',
      source: `app-${i}`,
      target: `cap-${i % capabilityCount}`,
      properties: {},
    })
    if (i + 1 < appCount) {
      relationships.push({
        id: `rel-app-${i}`,
        type: 'Flow',
        source: `app-${i}`,
        target: `app-${i + 1}`,
        properties: {},
      })
    }
  }

  return {
    id,
    name: `Synthetic ${size}`,
    schemaVersion: SCHEMA_VERSION,
    elements,
    relationships,
    views: [],
    folders: [],
    reports: [],
    tagGroups: [DEFAULT_TAG_GROUP],
  }
}

/**
 * `smallWorkspace` drawn (#75): folders, two views, nesting, bend-points, a
 * note, a group, a view reference and appearance overrides. The Claim Handling
 * Engine is drawn in both views, so deleting it has to reach into each.
 */
export function drawnWorkspace(): Workspace {
  const base = smallWorkspace()
  const folders: Folder[] = [
    { id: 'f-business', name: 'Claims', root: 'business' },
    {
      id: 'f-core',
      name: 'Core processes',
      parent: 'f-business',
      documentation: 'The money-makers.',
    },
    { id: 'f-apps', name: 'Claims apps', root: 'application' },
    { id: 'f-relations', name: 'Claims relations', root: 'relations' },
    { id: 'f-views', name: 'Landscapes', root: 'views' },
  ]
  const fileIn: Record<string, string> = {
    'proc-claim': 'f-core',
    'app-claims': 'f-apps',
    'rel-app-proc': 'f-relations',
  }
  const elements = base.elements.map((element) => {
    const folder = fileIn[element.id]
    return folder ? { ...element, folder } : element
  })
  const relationships = base.relationships.map((relationship) => {
    const folder = fileIn[relationship.id]
    return folder ? { ...relationship, folder } : relationship
  })

  const landscape: View = {
    id: 'view-landscape',
    name: 'Claims landscape',
    documentation: 'How claims are handled, top to bottom.',
    viewpoint: 'Layered',
    folder: 'f-views',
    properties: { status: 'draft' },
    nodes: [
      {
        id: 'g-claims',
        kind: 'group',
        name: 'Claims',
        bounds: { x: 0, y: 0, width: 600, height: 400 },
        appearance: { fillColor: '#f5f0e6', lineColor: '#333333', lineWidth: 2 },
      },
      {
        id: 'n-proc',
        kind: 'element',
        element: 'proc-claim',
        parent: 'g-claims',
        bounds: { x: 20, y: 40, width: 120, height: 55 },
      },
      {
        id: 'n-app',
        kind: 'element',
        element: 'app-claims',
        parent: 'g-claims',
        bounds: { x: 20, y: 200, width: 120, height: 55 },
        appearance: {
          fontName: 'Inter',
          fontSize: 11,
          fontColor: '#000000',
          fontStyle: ['bold', 'italic'],
          textAlignment: 'left',
          textPosition: 'top',
        },
      },
      {
        id: 'n-k8s',
        kind: 'element',
        element: 'tec-k8s',
        bounds: { x: 20, y: 460, width: 120, height: 55 },
      },
      {
        id: 'n-note',
        kind: 'note',
        text: 'Rules engine goes live 2027.',
        bounds: { x: 300, y: 40, width: 180, height: 60 },
        parent: 'g-claims',
      },
      {
        id: 'n-ref',
        kind: 'view-ref',
        view: 'view-detail',
        bounds: { x: 300, y: 460, width: 120, height: 55 },
      },
    ],
    connections: [
      {
        id: 'c-serving',
        kind: 'relationship',
        relationship: 'rel-app-proc',
        source: 'n-app',
        target: 'n-proc',
        bendpoints: [
          { x: 80, y: 180 },
          { x: 80, y: 120 },
        ],
      },
      {
        id: 'c-k8s',
        kind: 'relationship',
        relationship: 'rel-k8s-app',
        source: 'n-k8s',
        target: 'n-app',
        appearance: { lineColor: '#aa0000' },
      },
      { id: 'c-note', kind: 'line', name: 'see', source: 'n-note', target: 'n-app' },
    ],
  }
  const detail: View = {
    id: 'view-detail',
    name: 'Claim data',
    properties: {},
    nodes: [
      {
        id: 'd-app',
        kind: 'element',
        element: 'app-claims',
        bounds: { x: 0, y: 0, width: 120, height: 55 },
      },
      {
        id: 'd-obj',
        kind: 'element',
        element: 'obj-claim',
        bounds: { x: 200, y: 0, width: 120, height: 55 },
      },
    ],
    connections: [
      {
        id: 'd-access',
        kind: 'relationship',
        relationship: 'rel-app-obj',
        source: 'd-app',
        target: 'd-obj',
      },
    ],
  }

  // In canonical order (by id; a view's nodes in drawing order, #136), so a
  // workspace read back from its own canonical JSON compares equal to this one,
  // arrays included.
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const views = [detail, landscape].map((view) => ({
    ...view,
    nodes: drawingOrder({ ...view, nodes: [...view.nodes].sort(byId) }),
    connections: [...view.connections].sort(byId),
  }))
  return { ...base, elements, relationships, folders: [...folders].sort(byId), views }
}

/**
 * A file that cannot be read, as a sync client leaves one by replacing it
 * between the pick and the read (#52). Every read rejects: `text()` as well as
 * the `arrayBuffer()` the reader calls today, so the file stays unreadable
 * whichever read a reader uses.
 */
export function unreadableFile(name: string): File {
  const rejection = () => Promise.reject(new DOMException('The file changed.', 'NotReadableError'))
  return Object.assign(new File(['{}'], name, { type: 'application/json' }), {
    arrayBuffer: rejection,
    text: rejection,
  })
}
