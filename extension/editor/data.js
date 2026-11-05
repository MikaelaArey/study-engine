// ---------------------------------------------------------------------------
// Sample content. Everything here is example material for the prototype:
// Maya's notes and drafts, a biology guide, quizzes, exam profiles and drills.
// Patterns in `any` lists are case-insensitive regular expressions used by the
// offline grader when live AI isn't available.
// ---------------------------------------------------------------------------

const COURSES = {
  bio: {
    name: 'AP Biology',
    unit: 'Unit 4: Cellular respiration',
    exam: 'Test on Friday',
    concepts: [
      { id: 'glyc-loc', label: 'Where glycolysis happens' },
      { id: 'glyc-atp', label: 'ATP from glycolysis' },
      { id: 'glyc-o2', label: 'Glycolysis without oxygen' },
      { id: 'krebs', label: 'Krebs cycle' },
      { id: 'carriers', label: 'NADH and FADH2' },
      { id: 'etc', label: 'Electron transport chain' },
      { id: 'o2-role', label: 'Why the ETC needs oxygen' },
      { id: 'ferment', label: 'Fermentation' },
      { id: 'enzymes', label: 'Enzymes and temperature' },
    ],
    terms: [
      ['glycolysis', '\\bglycoly(sis|tic)\\b'],
      ['pyruvate', '\\bpyruv(ate|ic)\\b'],
      ['Krebs cycle', '\\bkrebs\\b'],
      ['mitochondria', '\\bmitochondri(a|on|al)\\b'],
      ['NADH', '\\bnadh\\b'],
      ['FADH2', '\\bfadh2?\\b'],
      ['electron transport chain', '\\belectron transport chain\\b|\\betc\\b'],
      ['ATP synthase', '\\batp synthase\\b'],
      ['fermentation', '\\bferment(ation|s|ed|ing)?\\b'],
      ['enzyme', '\\benzymes?\\b'],
      ['denatured', '\\bdenatur(e|ed|es|ing|ation)\\b'],
      ['rate of reaction', '\\b(rate of (the )?reaction|reaction rate)\\b'],
    ],
  },
  world: {
    name: 'AP World History',
    unit: 'Unit 5: Industrialization',
    exam: 'Unit test next Tuesday',
    concepts: [
      { id: 'causes', label: 'Why Britain industrialized first' },
      { id: 'enclosure', label: 'Enclosure movement' },
      { id: 'capital', label: 'Capital and banking' },
      { id: 'ir-def', label: 'What the Industrial Revolution changed' },
      { id: 'factory', label: 'Factory system' },
      { id: 'urban', label: 'Urbanization' },
      { id: 'labor', label: 'Unions and labor reform' },
      { id: 'luddites', label: 'Luddites' },
      { id: 'wages', label: 'Wages and living standards' },
    ],
    terms: [
      ['industrialization', '\\bindustriali[sz](ation|ed|e|ing)\\b'],
      ['factory system', '\\bfactor(y|ies)\\b'],
      ['urbanization', '\\burbani[sz](ation|ed)\\b'],
      ['enclosure', '\\benclos(ure|ed)\\b'],
      ['capital', '\\bcapital\\b'],
      ['Luddites', '\\bluddites?\\b'],
      ['labor union', '\\bunions?\\b'],
      ['working class', '\\bworking class\\b'],
      ['textile', '\\btextiles?\\b'],
      ['steam engine', '\\bsteam\\b'],
      ['child labor', '\\bchild(ren)? (labou?r|work)|\\bchildren\\b'],
      ['Factory Act', '\\bfactory acts?\\b'],
    ],
  },
  // Your own documents: no sample course, so no concept map until a study guide makes one.
  own: {
    name: 'Your writing',
    unit: 'Your documents',
    exam: '',
    concepts: [],
    terms: [],
  },
};

// Starting mastery: solid, shaky, missed or new (not tried yet).
const MASTERY = {
  'glyc-loc': 'solid', 'glyc-atp': 'shaky', 'glyc-o2': 'new', krebs: 'missed', carriers: 'new',
  etc: 'new', 'o2-role': 'new', ferment: 'shaky', enzymes: 'solid',
  causes: 'shaky', enclosure: 'new', capital: 'new', 'ir-def': 'shaky', factory: 'solid',
  urban: 'solid', labor: 'new', luddites: 'solid', wages: 'new',
};

const WORDS = [
  { word: 'enzyme', course: 'bio', status: 'owned', uses: 3 },
  { word: 'substrate', course: 'bio', status: 'used', uses: 2 },
  { word: 'active site', course: 'bio', status: 'tried', uses: 0 },
  { word: 'fermentation', course: 'bio', status: 'seen', uses: 0 },
  { word: 'contextualization', course: 'world', status: 'used', uses: 1 },
  { word: 'enclosure', course: 'world', status: 'tried', uses: 0 },
];

// Each register also sets the writing review's goal (`goal`, see lib/rules.js).
const REGISTERS = [
  { id: 'natural', goal: 'errors', name: 'My natural voice', for: 'Personal writing and first drafts', rewards: 'Your own style', flags: 'Errors only' },
  { id: 'general', goal: 'general', name: 'General', for: 'Most writing', rewards: 'Clear, correct sentences', flags: 'Errors, wordiness, weak words' },
  { id: 'professional', goal: 'professional', name: 'Professional', for: 'Work email and documents', rewards: 'Concise, confident wording', flags: 'Informal words, hedging' },
  { id: 'simple', goal: 'simple', name: 'Simplified Conceptual', for: 'Explaining an idea, or learning English', rewards: 'Short sentences, everyday words, examples', flags: 'Unexplained jargon, sentences over 25 words' },
  { id: 'academic', goal: 'academic', name: 'Socratic Academic', for: 'Argument essays and seminar papers', rewards: 'Precise claim verbs, hedges, counterarguments', flags: 'Absolute claims, vague verbs, unsupported generalizations' },
  { id: 'technical', goal: 'technical', name: 'Domain-Specific Technical', for: 'Lab reports, case studies, technical answers', rewards: 'The subject’s own terms, correct units', flags: 'Everyday words where the subject has a term' },
  { id: 'highyield', goal: 'academic', name: 'SAT/GRE High-Yield', for: 'Building test vocabulary', rewards: 'Test words used correctly in your own sentences', flags: 'Words used in the wrong sense' },
];

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const BIO_NOTES = `Cell resp, Oct 3-10

C6H12O6 + 6O2 -> 6CO2 + 6H2O + ATP

GLYCOLYSIS
glycolysis = cytoplasm, 2 ATP (Oct 6)
glucose -> 2 pyruvate
no O2 needed!! just needs NAD+
glycolysis makes 4 ATP (Oct 8)

KREBS
krebs -> mito matrix
makes NADH + FADH2, CO2 released

ETC
ETC makes most ATP!! (on test)
inner membrane, O2 at the very end

FERMENTATION
no O2 -> fermentation, gets NAD+ back
yeast: alcohol + CO2, muscles: lactic acid`;

const WORLD_NOTES = `Why Britain first? (Sept 12)
coal + iron close together
colonies = raw materials (cotton) + markets
capital: banks, investors, profits from trade
ag revolution / enclosure -> fewer farm jobs -> workers move to cities
rivers + canals, stable government
IR = hand tools + work at home -> machines + factories, new energy (steam)
factory work: long hours, child labor, dangerous machines`;

const TEXTBOOK_ETC = 'The electron transport chain is a series of proteins in the inner mitochondrial membrane. Electrons from NADH and FADH2 pass along the chain, and the energy released pumps hydrogen ions (protons) into the space between the membranes. The ions flow back through ATP synthase, which uses that flow to make ATP. Oxygen accepts the electrons at the end of the chain and forms water.';

const DOCS = [
  {
    id: 'bio-notes', kind: 'notes', course: 'bio', feature: 1,
    title: 'Cellular respiration notes',
    blurb: 'Messy notes and a worksheet, turned into a study guide',
    text: BIO_NOTES,
    attachments: ['Ch. 9 review worksheet (3 questions)'],
    suggestions: [],
  },
  {
    id: 'lab', kind: 'draft', course: 'bio', feature: 2, register: 'technical',
    title: 'Yeast fermentation lab',
    blurb: 'Vocabulary coaching in the Domain-Specific Technical register',
    text: `Results: at 20°C the yeast made 0.8 mL of gas per minute, at 37°C it made 2.1 mL per minute, and at 60°C it made none.

Conclusion: The yeast made more gas when it was warmer because the enzymes worked faster. At 60°C the enzymes broke and the gas stopped. The temperature effected the rate a lot.`,
    suggestions: [
      {
        id: 'lab-gas', kind: 'words', quote: 'made more gas', title: 'Name the gas and the process', concept: 'ferment',
        nudge: 'Which gas, and what’s the process called? Use your unit’s terms.',
        accept: [{ text: 'the gas', any: ['co2', 'co₂', 'carbon dioxide'] }, { text: 'the process', any: ['ferment'] }],
        word: 'fermentation', pos: 'noun',
        definition: 'Breaking down sugar without oxygen to release energy. Yeast gives off CO2 and alcohol.',
        why: 'Your gas came from yeast breaking down sugar. Naming the process shows where the CO2 came from.',
        example: 'In the sealed flask, fermentation produced CO2 that filled the balloon.',
        watchOut: 'Fermentation isn’t respiration with oxygen. It makes far less ATP.',
        target: ['ferment'], priority: 0.7,
      },
      {
        id: 'lab-faster', kind: 'words', quote: 'worked faster', title: 'Say what you measured', concept: 'enzymes',
        nudge: 'What did you actually measure? There’s a more exact phrase for “worked faster”.',
        accept: [{ text: 'rate', any: ['rate'] }],
        word: 'rate of reaction', pos: 'noun phrase',
        definition: 'How much product forms per unit of time.',
        why: 'It’s what you measured: millilitres of gas per minute.',
        example: 'Raising the temperature to 37°C increased the rate of reaction.',
        watchOut: 'A faster rate means more product per minute, not more product in total.',
        target: ['rate'], priority: 0.6,
      },
      {
        id: 'lab-broke', kind: 'words', quote: 'broke', title: 'A precise word for “broke”', concept: 'enzymes',
        nudge: 'There’s a biology term for what heat does to an enzyme’s shape. Can you name it?',
        accept: [{ text: 'denatured', any: ['denatur'] }],
        word: 'denatured', pos: 'verb, past tense',
        definition: 'Changed shape so it no longer works, usually because of heat or acid.',
        why: 'Your enzymes didn’t break apart. Their shape changed, so the active site stopped working.',
        example: 'Above 60°C, the amylase denatured and starch digestion stopped.',
        watchOut: 'A denatured protein isn’t destroyed; its chain is still intact.',
        target: ['denatur'], priority: 0.8,
      },
      {
        id: 'lab-effected', kind: 'fix', quote: 'effected', title: 'Spelling: affected', concept: null,
        replacement: 'affected', explanation: '“Effect” is usually a noun. The verb is “affect”.', priority: 0.9,
      },
      {
        id: 'lab-alot', kind: 'words', quote: 'a lot', title: 'How much is “a lot”?', concept: 'enzymes',
        nudge: 'By how much? Use your data.',
        accept: [{ text: 'a number from your data', any: ['\\d'] }],
        word: 'your measurements', pos: 'data',
        definition: 'The numbers you recorded in your results.',
        why: 'Numbers make the claim checkable: from 0.8 to 2.1 mL per minute between 20°C and 37°C.',
        example: 'The rate rose from 0.8 to 2.1 mL per minute.',
        watchOut: 'Give units with every number.',
        target: ['\\d'], priority: 0.5,
      },
    ],
  },
  {
    id: 'essay', kind: 'draft', course: 'world', feature: 3, register: 'academic', notes: WORLD_NOTES,
    title: 'Why Britain industrialized first',
    blurb: 'Socratic underlines that ask instead of fix',
    text: `Britain industrialized first. Most historians agree it was a turning point, a new way of making things. Enclosure pushed farm workers into the cities, and the goverment did little to protect them. It happened there because Britain had lots of coal.

Factories always paid workers less than farms did, so families sent their children to work. The Industrial Revolution was a big change in how things were made.`,
    suggestions: [
      {
        id: 'es-thesis', kind: 'rubric', quote: 'Britain industrialized first.', title: 'Thesis: give your reasons', concept: 'causes', criterion: 'thesis',
        question: 'Your first sentence says what happened. What are the two or three reasons you’ll argue?', priority: 0.4,
      },
      {
        id: 'es-historians', kind: 'reason', quote: 'Most historians agree', title: 'Back up “most historians”', concept: 'causes',
        question: 'Which historians? What’s your evidence?',
        keyPoints: [{ text: 'a source or a piece of evidence', any: ['according to', 'historian', 'textbook', 'source', '\\bdoc', 'evidence', 'for example', 'data', 'wrote', 'argue', 'show', 'record'] }],
        hints: ['Name a source, or say what the evidence shows.', 'If you can’t name one, would the sentence be stronger without “most historians agree”?'],
        reveal: 'Name a source or say what the evidence shows. If you can’t, cut “most historians agree” and make the claim yourself.',
        source: 'Writing advice, not from your notes', priority: 0.5,
      },
      {
        id: 'es-enclosure', kind: 'words', mode: 'define', quote: 'Enclosure', title: 'Define “enclosure”', concept: 'enclosure',
        question: 'Define enclosure in 10 words or fewer.',
        keyPoints: [
          { text: 'common land fenced into private farms', any: ['fenc', 'hedg', 'private', 'common', 'open field', 'consolidat', 'land'] },
          { text: 'small farmers lost land or work', any: ['lost', 'push', 'forc', 'evict', 'small farmer', 'peasant', 'fewer jobs', 'off the land', 'no work'] },
        ],
        hints: ['Think about what happened to land the whole village used to share.', 'Who owned that land afterwards, and what happened to the people who farmed it?'],
        reveal: 'Fencing off shared village land into private farms, which pushed many small farmers off the land.',
        source: 'Your notes, Sept 12', priority: 0.6,
      },
      {
        id: 'es-gov', kind: 'fix', quote: 'goverment', title: 'Spelling: government', concept: null,
        replacement: 'government', explanation: 'It’s spelled with an n before the m.', priority: 0.9,
      },
      {
        id: 'es-coal', kind: 'reason', quote: 'because Britain had lots of coal.', title: 'Coal is one reason', concept: 'causes',
        question: 'Coal is one reason. What else did Britain have that other countries didn’t? Name two.',
        keyPoints: [
          { text: 'colonies', any: ['colon', 'empire', 'raw material', 'market', 'cotton', 'trade'] },
          { text: 'capital to invest', any: ['capital', 'bank', 'invest', 'money', 'profit', 'wealth', 'rich'] },
          { text: 'workers freed up by enclosure', any: ['worker', 'labou?r', 'enclos', 'population', 'people', 'farm'] },
          { text: 'iron', any: ['\\biron'] },
          { text: 'rivers and canals', any: ['river', 'canal', 'port', 'coast', 'transport', 'sea'] },
          { text: 'a stable government', any: ['stable', 'government', 'politic', 'law', 'patent'] },
        ],
        needed: 2,
        hints: ['Think about money, land and people.', 'Your notes from Sept 12 list colonies first. What did colonies give Britain?'],
        reveal: 'Colonies (raw materials and markets), capital to invest, and workers freed up by enclosure. Iron, rivers and canals, and a stable government helped too.',
        source: 'Your notes, Sept 12', priority: 0.8,
      },
      {
        id: 'es-always', kind: 'reason', quote: 'always', hintText: 'Factories always paid', title: 'Is it always true?', concept: 'wages',
        question: 'Always? Can you think of a case that doesn’t fit?',
        keyPoints: [{ text: 'pay varied, and factory pay was often higher', any: ['higher', 'more', 'better', 'varied', 'depend', 'some', 'not always', 'skilled', 'sometimes', 'depends'] }],
        hints: ['Why did so many people move from farms to factories?', 'Compare what a farm laborer and a mill worker earned.'],
        reveal: 'Not always. Factory wages were often higher than farm wages. The bigger costs were long hours, danger and high city rents.',
        source: 'Not from your notes', priority: 0.5,
      },
      {
        id: 'es-ir', kind: 'remember', quote: 'The Industrial Revolution was a big change in how things were made.', title: 'Explain it without notes', concept: 'ir-def',
        question: 'Explain the Industrial Revolution in one sentence, without your notes. What changed, and from what to what?',
        keyPoints: [
          { text: 'hand tools to machines', any: ['machine', 'mechani'] },
          { text: 'work moved into factories', any: ['factor', 'mill'] },
          { text: 'new energy such as steam', any: ['steam', 'engine', 'energy', 'water power', 'coal power', 'power'] },
        ],
        needed: 2,
        hints: ['What did people make things with before, and after?', 'Where did the work happen before? And what powered the new machines?'],
        reveal: 'Work moved from hand tools at home to machines in factories, powered by new energy such as steam.',
        source: 'Your notes, Sept 12', priority: 0.7,
      },
    ],
  },
  {
    id: 'dbq', kind: 'draft', course: 'world', feature: 4, register: 'academic', profile: 'ap-dbq', notes: WORLD_NOTES,
    title: 'DBQ practice: workers and industrialization',
    blurb: 'An exam profile, a timed rehearsal and the rubric audit',
    prompt: 'Evaluate the extent to which industrialization changed the lives of workers in Europe from 1800 to 1900.',
    text: `Industrialization changed workers' lives a great deal, because it moved them into factories, changed their hours and pay, and led them to organize.

Factory work meant long, fixed hours. A textile worker said they worked from six in the morning to seven at night, with children beside them (Doc 1). Towns grew so fast that housing was crowded and disease spread (Doc 2).

Workers began to fight back. The Luddites smashed machines, and later unions asked for a ten-hour day (Doc 5). By the end of the century, many workers had more rights than before.`,
    suggestions: [],
  },
];

// Practice documents for the DBQ. Invented for this prototype, not historical sources.
const DBQ_SOURCES = [
  { n: 1, who: 'A textile worker, speaking in 1833', text: 'We start at the mill at six in the morning and stop at seven at night. The children work beside us.' },
  { n: 2, who: 'A town doctor’s report, 1842', text: 'Workers’ houses are crowded and damp, and fever spreads quickly through the courts.' },
  { n: 3, who: 'A newspaper report, 1850', text: 'Mill wages are higher than wages on the farms, but rent and food in town cost more.' },
  { n: 4, who: 'A mill owner, to a committee of Parliament, 1833', text: 'The children in my mill are well treated, and the work is light.' },
  { n: 5, who: 'A workers’ union pamphlet, 1871', text: 'We ask for a working day of ten hours, so that a man may see his children by daylight.' },
  { n: 6, who: 'A table of factory wages, 1800 to 1900', text: 'After 1850, what a factory wage could buy rose steadily.' },
  { n: 7, who: 'A farm laborer’s letter, 1860', text: 'Life in the village goes on as it always has. The work is hard and the pay is poor.' },
];

// ---------------------------------------------------------------------------
// Study guide for the biology notes (what the guide builder would write)
// ---------------------------------------------------------------------------

const GUIDE_BIO = {
  title: 'Unit 4: Cellular respiration',
  meta: 'From your notes, Oct 3-10, and the Ch. 9 worksheet',
  sections: [
    {
      id: 'g1', heading: 'Glycolysis', intro: 'The first stage. It splits glucose, and it doesn’t need oxygen.',
      blocks: [
        { id: 'b-cloze1', type: 'cloze', concept: 'glyc-loc', text: 'Glycolysis splits one glucose into two {pyruvate} in the {cytoplasm}.',
          accept: { pyruvate: ['pyruvate', 'pyruvic acid', 'pyruvates'], cytoplasm: ['cytoplasm', 'cytosol'] }, line: 'glycolysis = cytoplasm', source: 'Your notes, Oct 6' },
        { id: 'b-q1', type: 'qa', concept: 'glyc-o2', question: 'Why can glycolysis run without oxygen?',
          keyPoints: [
            { text: 'none of its steps uses oxygen', any: ['no (step|part)', 'doesn.?t (use|need)', 'not (use|need)', 'without (o2|oxygen)', 'no (o2|oxygen)', 'anaerobic', 'never uses'] },
            { text: 'it needs NAD+ to keep going', any: ['nad'] },
          ],
          needed: 1, hints: ['Look at which molecules glycolysis takes in. Is oxygen one of them?'],
          reveal: 'None of its steps uses oxygen. It only needs a supply of NAD+, which fermentation can give back.', line: 'no O2 needed', source: 'Your notes, Oct 6' },
        { id: 'b-card1', type: 'flashcard', concept: 'carriers', front: 'NADH', back: 'An electron carrier. It picks up electrons in glycolysis and the Krebs cycle and delivers them to the ETC.' },
        { id: 'b-conflict', type: 'conflict', concept: 'glyc-atp', text: 'Your notes say glycolysis makes 2 ATP on Oct 6 and 4 ATP on Oct 8. Both can be right: it makes 4 and uses 2, a net gain of 2.' },
        { id: 'b-ws1', type: 'qa', concept: 'glyc-loc', worksheet: 1, question: 'Where in the cell does glycolysis take place?',
          keyPoints: [{ text: 'the cytoplasm', any: ['cytoplasm', 'cytosol'] }], hints: ['Show me where: your notes answer this.'],
          reveal: 'In the cytoplasm.', line: 'glycolysis = cytoplasm', source: 'Your notes, Oct 6' },
      ],
    },
    {
      id: 'g2', heading: 'Krebs cycle', intro: 'The second stage, inside the mitochondria.',
      blocks: [
        { id: 'b-cloze2', type: 'cloze', concept: 'krebs', text: 'The Krebs cycle runs in the mitochondrial {matrix} and releases {CO2} as waste.',
          accept: { matrix: ['matrix'], CO2: ['co2', 'co₂', 'carbon dioxide'] }, line: 'krebs -> mito matrix', source: 'Your notes, Oct 7' },
        { id: 'b-q2', type: 'qa', concept: 'carriers', question: 'What does the Krebs cycle hand on to the electron transport chain?',
          keyPoints: [{ text: 'NADH', any: ['nadh'] }, { text: 'FADH2', any: ['fadh'] }], hints: ['Two electron carriers. One of them is on the flashcard above.'],
          reveal: 'NADH and FADH2, the electron carriers it fills.', line: 'makes NADH + FADH2', source: 'Your notes, Oct 7' },
        { id: 'b-card2', type: 'flashcard', concept: 'carriers', front: 'FADH2', back: 'Another electron carrier filled in the Krebs cycle. Like NADH, it delivers electrons to the ETC.' },
        { id: 'b-ws3', type: 'qa', concept: 'krebs', worksheet: 3, question: 'What does the Krebs cycle release as waste?',
          keyPoints: [{ text: 'carbon dioxide', any: ['co2', 'co₂', 'carbon dioxide'] }], hints: ['Show me where: your notes answer this.'],
          reveal: 'Carbon dioxide (CO2).', line: 'CO2 released', source: 'Your notes, Oct 7' },
      ],
    },
    {
      id: 'g3', heading: 'Electron transport chain', intro: 'The last stage, where most ATP is made.', tag: 'On the test',
      blocks: [
        { id: 'b-gap', type: 'gap', concept: 'etc', text: 'Your notes say the ETC makes most ATP, but not how. Worksheet question 7 asks it.' },
        { id: 'b-explain', type: 'explain', concept: 'etc', needsTextbook: true, question: 'Explain how the ETC makes ATP, in two or three sentences.',
          keyPoints: [
            { text: 'electrons pass along proteins in the inner membrane', any: ['electron', 'protein', 'membrane', 'chain'] },
            { text: 'that pumps protons, building a gradient', any: ['proton', 'hydrogen', 'h\\+', 'gradient', 'pump'] },
            { text: 'protons flow back through ATP synthase, making ATP', any: ['synthase', 'flow back', 'chemiosmo', 'turbine'] },
          ],
          hints: ['Start with where the electrons come from, then where they go.', 'What builds up on one side of the membrane, and what does it flow back through?'],
          reveal: 'Electrons from NADH and FADH2 pass along proteins in the inner membrane, pumping protons across it. The protons flow back through ATP synthase, which uses the flow to make ATP.',
          source: 'Textbook, section 9.4' },
        { id: 'b-ws7', type: 'qa', concept: 'etc', worksheet: 7, needsTextbook: true, question: 'How does the electron transport chain produce ATP?',
          keyPoints: [
            { text: 'a proton gradient', any: ['proton', 'hydrogen', 'gradient', 'h\\+'] },
            { text: 'ATP synthase', any: ['synthase'] },
          ],
          hints: ['Show me where: the textbook excerpt answers this.'],
          reveal: 'It pumps protons across the inner membrane, and their flow back through ATP synthase makes ATP.', source: 'Textbook, section 9.4' },
        { id: 'b-cloze3', type: 'cloze', concept: 'o2-role', needsTextbook: true, text: 'At the end of the chain, {oxygen} accepts the electrons and forms {water}.',
          accept: { oxygen: ['oxygen', 'o2', 'o₂'], water: ['water', 'h2o', 'h₂o'] }, source: 'Textbook, section 9.4' },
      ],
    },
    {
      id: 'g4', heading: 'Fermentation', intro: 'What cells do when there’s no oxygen.',
      blocks: [
        { id: 'b-compare', type: 'compare', concept: 'ferment', cols: ['', 'Aerobic respiration', 'Fermentation'],
          rows: [
            ['Needs oxygen?', 'Yes', { blank: 'No', accept: ['no'] }],
            ['Where it happens', 'Cytoplasm and mitochondria', { blank: 'Cytoplasm', accept: ['cytoplasm', 'cytosol'] }],
            ['ATP per glucose', 'Much more', { blank: '2', accept: ['2', 'two'] }],
            ['End products', 'CO2 and water', { blank: 'Lactic acid, or alcohol and CO2', accept: ['lactic', 'alcohol', 'ethanol'] }],
          ], line: 'yeast: alcohol + CO2', source: 'Your notes, Oct 9' },
        { id: 'b-cloze4', type: 'cloze', concept: 'ferment', text: 'Without oxygen, cells get back {NAD+} through fermentation, so glycolysis can keep going.',
          accept: { 'NAD+': ['nad+', 'nad', 'nad plus'] }, line: 'gets NAD+ back', source: 'Your notes, Oct 9' },
        { id: 'b-order', type: 'order', concept: 'etc', question: 'Put the stages of aerobic respiration in order.',
          items: ['Glycolysis', 'Krebs cycle', 'Electron transport chain'], start: [2, 0, 1] },
      ],
    },
  ],
  likely: ['Explain how the electron transport chain produces ATP.', 'Compare aerobic respiration and fermentation.', 'Why can glycolysis run without oxygen?'],
};

// ---------------------------------------------------------------------------
// Practice quizzes (what the quiz writer would write for the weak spots)
// ---------------------------------------------------------------------------

const QUIZZES = {
  bio: [
    { id: 'qb1', type: 'mcq', rung: 'Recognise', concept: 'krebs', question: 'Where does the Krebs cycle take place?',
      options: [
        { text: 'Mitochondrial matrix', correct: true },
        { text: 'Cytoplasm', why: 'That’s where glycolysis happens.' },
        { text: 'Inner mitochondrial membrane', why: 'That’s where the electron transport chain sits.' },
        { text: 'Nucleus', why: 'The nucleus holds DNA; respiration doesn’t happen there.' },
      ], explain: 'The Krebs cycle runs in the matrix, the fluid inside the mitochondria.', source: 'Your notes, Oct 7' },
    { id: 'qb2', type: 'cloze', rung: 'Recall', concept: 'glyc-atp', question: 'Glycolysis has a net gain of {2} ATP per glucose.',
      accept: { 2: ['2', 'two'] }, explain: 'It makes 4 ATP and uses 2, a net gain of 2.', source: 'Your notes, Oct 6 and Oct 8' },
    { id: 'qb3', type: 'short', rung: 'Recall', concept: 'carriers', question: 'Name the two electron carriers that bring electrons to the ETC.',
      keyPoints: [{ text: 'NADH', any: ['nadh'] }, { text: 'FADH2', any: ['fadh'] }],
      explain: 'NADH and FADH2, filled during glycolysis and the Krebs cycle.', source: 'Your notes, Oct 7' },
    { id: 'qb4', type: 'short', rung: 'Apply', concept: 'etc', question: 'A poison stops protons from flowing back through ATP synthase. What happens to ATP production, and why?',
      keyPoints: [
        { text: 'ATP production falls', any: ['fall', 'drop', 'decreas', 'stop', 'less', 'lower', 'reduc', 'slow', 'no atp', 'can.?t make', 'won.?t make', 'not make'] },
        { text: 'ATP synthase needs the proton flow', any: ['synthase', 'proton', 'flow', 'gradient', 'h\\+', 'hydrogen'] },
      ],
      explain: 'Most ATP is made by protons flowing back through ATP synthase. Block the flow and most ATP production stops.', source: 'Textbook, section 9.4' },
    { id: 'qb5', type: 'short', rung: 'Explain', concept: 'o2-role', question: 'Why does the electron transport chain need oxygen?',
      keyPoints: [
        { text: 'oxygen is the final electron acceptor', any: ['accept', 'final', 'end of the chain', 'takes the electrons', 'picks up', 'grabs', 'last'] },
        { text: 'without it the chain stops', any: ['stop', 'back', 'jam', 'can.?t', 'halt', 'no atp', 'wouldn.?t', 'blocked', 'stuck'] },
      ],
      explain: 'Oxygen takes the electrons at the end of the chain. Without it, electrons back up and the chain stops.', source: 'Textbook, section 9.4' },
    { id: 'qb6', type: 'mcq', rung: 'Recognise', concept: 'ferment', question: 'Which process lets glycolysis keep going when there’s no oxygen?',
      options: [
        { text: 'Fermentation', correct: true },
        { text: 'The Krebs cycle', why: 'The Krebs cycle depends on the ETC, which needs oxygen.' },
        { text: 'The electron transport chain', why: 'The ETC needs oxygen at the end of the chain.' },
        { text: 'Photosynthesis', why: 'Photosynthesis makes glucose; it doesn’t give back NAD+.' },
      ], explain: 'Fermentation gives back NAD+, which glycolysis needs to keep running.', source: 'Your notes, Oct 9' },
  ],
  world: [
    { id: 'qw1', type: 'mcq', rung: 'Recognise', concept: 'enclosure', question: 'Which change pushed many small farmers in Britain off the land?',
      options: [
        { text: 'Enclosure', correct: true },
        { text: 'The Factory Acts', why: 'Those were later laws about hours and safety in factories.' },
        { text: 'The Luddite movement', why: 'Luddites were workers protesting against machines.' },
        { text: 'Urbanization', why: 'Urbanization was a result: people moving to cities.' },
      ], explain: 'Enclosure fenced shared land into private farms, so many small farmers lost their land or work.', source: 'Your notes, Sept 12' },
    { id: 'qw2', type: 'short', rung: 'Recall', concept: 'causes', question: 'Name two advantages, besides coal, that helped Britain industrialize first.',
      keyPoints: [
        { text: 'colonies', any: ['colon', 'empire', 'raw material', 'market', 'cotton'] },
        { text: 'capital', any: ['capital', 'bank', 'invest', 'money', 'profit'] },
        { text: 'workers', any: ['worker', 'labou?r', 'enclos', 'population'] },
        { text: 'iron', any: ['\\biron'] },
        { text: 'rivers and canals', any: ['river', 'canal', 'transport', 'port'] },
        { text: 'a stable government', any: ['stable', 'government', 'politic'] },
      ], needed: 2, explain: 'Colonies, capital, workers freed up by enclosure, iron, rivers and canals, and a stable government.', source: 'Your notes, Sept 12' },
    { id: 'qw3', type: 'cloze', rung: 'Recall', concept: 'ir-def', question: 'The Industrial Revolution moved work from hand tools at home to {machines} in factories.',
      accept: { machines: ['machines', 'machinery', 'machine'] }, explain: 'Hand tools at home gave way to machines in factories.', source: 'Your notes, Sept 12' },
    { id: 'qw4', type: 'short', rung: 'Apply', concept: 'urban', question: 'A town’s population triples in 30 years after a mill opens. Name one problem workers there probably faced, and why.',
      keyPoints: [
        { text: 'crowded housing or disease', any: ['crowd', 'hous', 'disease', 'sanit', 'dirty', 'slum', 'rent', 'water', 'sewage', 'fever', 'ill'] },
        { text: 'because the town grew faster than it could cope', any: ['fast', 'grew', 'too many', 'quick', 'more people', 'not enough', 'couldn.?t keep'] },
      ], explain: 'Towns grew faster than housing and sanitation, so crowding and disease spread.', source: 'Not from your notes' },
    { id: 'qw5', type: 'mcq', rung: 'Recognise', concept: 'luddites', question: 'What did the Luddites do?',
      options: [
        { text: 'Smashed machines they blamed for lost jobs', correct: true },
        { text: 'Wrote the first factory laws', why: 'Parliament passed the Factory Acts.' },
        { text: 'Built the first railways', why: 'Engineers and investors built the railways.' },
        { text: 'Ran the first trade unions', why: 'Unions grew later in the century.' },
      ], explain: 'Luddites were textile workers who broke machines they blamed for cutting jobs and wages.', source: 'Not from your notes' },
    { id: 'qw6', type: 'short', rung: 'Explain', concept: 'labor', question: 'Why did workers form unions in the 1800s?',
      keyPoints: [
        { text: 'to bargain together', any: ['together', 'bargain', 'collective', 'strike', 'organi[sz]e', 'united', 'strength'] },
        { text: 'for shorter hours, better pay or safer work', any: ['hours', 'pay', 'wage', 'safe', 'condition', 'rights'] },
      ], explain: 'Together they could bargain for shorter hours, better pay and safer conditions.', source: 'Not from your notes' },
  ],
};

// ---------------------------------------------------------------------------
// Exam profiles
// ---------------------------------------------------------------------------

const PROFILES = {
  'ap-dbq': {
    name: 'AP World History DBQ',
    task: '7 documents · 60 minutes, including a 15-minute reading period',
    minutes: 60,
    source: 'College Board’s 7-point DBQ rubric',
    criteria: [
      { id: 'docs', label: 'Evidence from the documents', points: 2, plain: 'Three documents on the topic earn 1 point. Four supporting an argument earn 2.', question: 'Which documents haven’t you used yet? Doc 6 fits your second paragraph: what does it show about wages?' },
      { id: 'context', label: 'Contextualization', points: 1, plain: 'The broader history the question grows out of.', question: 'Your essay opens with the thesis. What was work like before factories, around 1750?' },
      { id: 'sourcing', label: 'Sourcing', points: 1, plain: 'For two documents, why the author’s point of view, purpose, situation or audience matters.', question: 'Doc 4 is a mill owner speaking to Parliament. Why might he describe conditions as good?', drill: true },
      { id: 'complex', label: 'Complex understanding', points: 1, plain: 'Nuance: several causes or perspectives, or a qualified argument.', question: 'Where did workers’ lives not change? Saying so would qualify your argument.' },
      { id: 'thesis', label: 'Thesis', points: 1, plain: 'A defensible claim that sets up your line of reasoning.', question: 'Does your first paragraph say why, not just what?' },
      { id: 'outside', label: 'Evidence beyond the documents', points: 1, plain: 'One specific piece of history the documents don’t mention.', question: 'What do you know about this period that none of the documents say?' },
    ],
    rules: [
      { id: 'cite', text: 'Cite documents as (Doc 3)' },
      { id: 'first', text: 'No first person' },
      { id: 'terms', text: 'Use at least 3 terms from this unit' },
    ],
  },
  business: {
    name: 'College business case study',
    task: 'Case write-up · 1,500 words',
    criteria: [
      { id: 'b1', label: 'The core problem, not its symptoms', question: 'If the CEO could fix one thing, what is it? Is that a cause or a symptom?' },
      { id: 'b2', label: 'Analysis grounded in the case’s numbers', question: 'Which exhibit backs this up? What does the number actually say?' },
      { id: 'b3', label: 'Real alternatives, weighed on stated criteria', question: 'What’s the strongest option you rejected, and why?' },
      { id: 'b4', label: 'A clear recommendation and its trade-offs', question: 'What does your recommendation cost the company?' },
      { id: 'b5', label: 'Implementation and risks', question: 'What could make this fail in the first 90 days?' },
      { id: 'b6', label: 'The answer up front', question: 'Could a busy manager get your answer from the first paragraph?' },
    ],
    rules: [{ id: 'exhibit', text: 'Back every claim with an exhibit or a case fact' }, { id: 'lead', text: 'Lead with the recommendation' }],
  },
  premed: {
    name: 'Pre-med biology synthesis',
    task: 'Short synthesis answer',
    criteria: [
      { id: 'p1', label: 'Every step of the mechanism', question: 'What happens between this step and the next?' },
      { id: 'p2', label: 'Links across levels, from molecule to body', question: 'How does this change in the cell show up in the whole organism?' },
      { id: 'p3', label: 'Precise terms, used correctly', question: 'Is there a more exact term from this unit?' },
      { id: 'p4', label: 'Reasoning from data', question: 'What would the control group show if your explanation is right?' },
      { id: 'p5', label: 'Predicting a disruption', question: 'What happens if this enzyme is blocked?' },
      { id: 'p6', label: 'Units and magnitudes', question: 'Is that number in the right units, and is it plausible?' },
    ],
    rules: [{ id: 'units', text: 'Give units with every number' }],
  },
};

// Sourcing drill: three short invented documents.
const DRILL = [
  { id: 'd1', doc: 'A mill owner, to a committee of Parliament, 1833', quote: 'The work in my mill is light, and the children are happy.', question: 'Why might he describe it this way?',
    keyPoints: [{ text: 'he wanted to avoid new laws or protect his business', any: ['law', 'regulat', 'rule', 'profit', 'money', 'business', 'reputation', 'avoid', 'protect', 'defend', 'blame', 'inspect', 'parliament', 'owner', 'bias'] }],
    reveal: 'He owns the mill and is speaking to lawmakers, so he has a reason to make conditions sound good and head off new laws.' },
  { id: 'd2', doc: 'A workers’ union pamphlet, 1871', quote: 'Our members work until they drop.', question: 'Why might the union describe it this way?',
    keyPoints: [{ text: 'to win support for shorter hours or reform', any: ['support', 'persuad', 'convinc', 'shorter', 'ten.hour', 'reform', 'recruit', 'members', 'sympath', 'exaggerat', 'demand', 'change', 'bias', 'purpose'] }],
    reveal: 'A pamphlet is meant to persuade. The union wants support for shorter hours, so it describes the work at its worst.' },
  { id: 'd3', doc: 'A government inspector’s report, 1840', quote: 'In most mills, the rules on children’s hours are now kept.', question: 'Why might the inspector describe it this way?',
    keyPoints: [{ text: 'to show the inspections and laws are working', any: ['job', 'success', 'effective', 'show', 'look good', 'government', 'credit', 'their work', 'prove', 'working', 'laws work', 'bias', 'purpose'] }],
    reveal: 'Inspectors report on their own work. Saying the rules are kept shows the laws, and the inspections, are working.' },
];
