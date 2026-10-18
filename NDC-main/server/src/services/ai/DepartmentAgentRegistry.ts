export interface DepartmentKnowledge {
  apparatusList?: string[];
  glasswareList?: string[];
  bookCategories?: string[];
  fineRules?: string[];
  policies?: string[];
  commonDues?: Array<{ item: string; defaultFine?: number; reason?: string }>;
}

export interface DepartmentAgentConfig {
  departmentCode: string;
  displayName: string;
  category: 'LABORATORY' | 'CENTRAL_DESK' | 'ACADEMIC_BRANCH';
  assistantInstructions: string;
  scannerInstructions: string;
  supportedOperations: Array<'ADD_DUE' | 'CLEAR_DUE' | 'HOLD' | 'LOOKUP_STUDENT' | 'CHECK_STATUS' | 'LIST_DUES'>;
  extractionSchema: {
    recordType: string;
    fields: Array<{
      name: string;
      label: string;
      type: 'string' | 'number' | 'date';
      required: boolean;
      description?: string;
    }>;
  };
  validationRules: {
    minDueAmount?: number;
    maxDueAmount?: number;
    requiresReason: boolean;
    allowedClearanceStatuses: string[];
    strictUsnPattern: RegExp;
  };
  clearanceTarget: string;
  requiredFields: string[];
  knowledgeSources: DepartmentKnowledge;
  enabled: boolean;
  version: string;
}

export class DepartmentAgentRegistry {
  private static registry: Map<string, DepartmentAgentConfig> = new Map();

  static {
    // 1. Engineering Physics Laboratory (PHY)
    this.register({
      departmentCode: 'PHY',
      displayName: 'Engineering Physics Laboratory',
      category: 'LABORATORY',
      assistantInstructions: `You are the specialized AI Assistant for the Engineering Physics Laboratory at Malnad College of Engineering (MCE).
You manage Physics laboratory apparatus, equipment damage/loss records, breakages, and clearance verification.
Domain Terms: sonometer, spectrometer, Newton's rings apparatus, diffraction grating, optical fiber, semiconductor laser, torsion pendulum, dielectric constant kit, vernier calipers, screw gauge, travelling microscope.
Clearance Rules: Dues must be recorded for broken apparatus or missing components with clear descriptions. Once settled or repaired, clearances can be approved.`,
      scannerInstructions: `Extract Physics Laboratory register records. Look for columns: USN, Student Name, Apparatus / Experiment Name, Damage / Breakage Description, Due Amount (INR), Date, and Signature.
Equipment keywords: sonometer wire, spectrometer prism, optical fiber cable, microscope eyepiece, laser kit, vernier calipers.`,
      supportedOperations: ['ADD_DUE', 'CLEAR_DUE', 'HOLD', 'LOOKUP_STUDENT', 'CHECK_STATUS', 'LIST_DUES'],
      extractionSchema: {
        recordType: 'PHYSICS_LAB_BREAKAGE_REGISTER',
        fields: [
          { name: 'usn', label: 'USN', type: 'string', required: true, description: 'Student University Seat Number' },
          { name: 'studentName', label: 'Student Name', type: 'string', required: false },
          { name: 'apparatus', label: 'Apparatus / Component', type: 'string', required: true },
          { name: 'reason', label: 'Breakage Details', type: 'string', required: true },
          { name: 'amount', label: 'Breakage Fine (₹)', type: 'number', required: false },
          { name: 'date', label: 'Incident Date', type: 'date', required: false }
        ]
      },
      validationRules: {
        minDueAmount: 1,
        maxDueAmount: 50000,
        requiresReason: true,
        allowedClearanceStatuses: ['PENDING', 'DUE', 'CLEARED', 'ON_HOLD'],
        strictUsnPattern: /^4MC\d{2}[A-Z]{2}\d{3}$/i
      },
      clearanceTarget: 'Physics Laboratory Clearance',
      requiredFields: ['usn', 'reason'],
      knowledgeSources: {
        apparatusList: [
          'Sonometer wire', 'Spectrometer prism', "Newton's rings glass plate",
          'Diffraction grating', 'Optical fiber cable', 'He-Ne / Semiconductor Laser',
          'Torsion pendulum wire', 'Dielectric constant sample', 'Travelling microscope',
          'Vernier calipers', 'Screw gauge'
        ],
        fineRules: [
          'Sonometer wire snap: ₹100 - ₹300',
          'Optic fiber core breakage: ₹1,000 - ₹2,000',
          'Diffraction grating scratch: ₹500 - ₹1,500',
          'Spectrometer optical alignment damage: ₹500 - ₹2,500',
          'Travelling microscope lens breakage: ₹1,500 - ₹3,000'
        ]
      },
      enabled: true,
      version: '1.0.0'
    });

    // 2. Engineering Chemistry Laboratory (CHEM)
    this.register({
      departmentCode: 'CHEM',
      displayName: 'Engineering Chemistry Laboratory',
      category: 'LABORATORY',
      assistantInstructions: `You are the specialized AI Assistant for the Engineering Chemistry Laboratory at MCE.
You manage glassware breakage, chemical spills, instrument damage, and chemistry clearance records.
Domain Terms: burette, pipette, conical flask, volumetric flask, beaker, measuring cylinder, pH meter, conductivity cell, potentiometer, colorimeter, analytical balance, water bath.
Clearance Rules: Chemistry laboratory dues correspond to broken glassware, lost spatulas/crucibles, or damaged sensors.`,
      scannerInstructions: `Extract Chemistry Laboratory breakage and due register records.
Columns: Sl No, USN, Student Name, Glassware / Equipment, Chemical / Experiment, Fine Amount (₹), Date, Signature.
Keywords: burette 50ml, pipette 25ml, volumetric flask 250ml, conductivity cell, pH electrode, beaker, crucible.`,
      supportedOperations: ['ADD_DUE', 'CLEAR_DUE', 'HOLD', 'LOOKUP_STUDENT', 'CHECK_STATUS', 'LIST_DUES'],
      extractionSchema: {
        recordType: 'CHEMISTRY_LAB_BREAKAGE_REGISTER',
        fields: [
          { name: 'usn', label: 'USN', type: 'string', required: true },
          { name: 'studentName', label: 'Student Name', type: 'string', required: false },
          { name: 'glassware', label: 'Glassware / Equipment', type: 'string', required: true },
          { name: 'reason', label: 'Damage Description', type: 'string', required: true },
          { name: 'amount', label: 'Replacement Fine (₹)', type: 'number', required: false },
          { name: 'date', label: 'Date', type: 'date', required: false }
        ]
      },
      validationRules: {
        minDueAmount: 1,
        maxDueAmount: 25000,
        requiresReason: true,
        allowedClearanceStatuses: ['PENDING', 'DUE', 'CLEARED', 'ON_HOLD'],
        strictUsnPattern: /^4MC\d{2}[A-Z]{2}\d{3}$/i
      },
      clearanceTarget: 'Chemistry Laboratory Clearance',
      requiredFields: ['usn', 'reason'],
      knowledgeSources: {
        glasswareList: [
          'Class-A Burette 50ml', 'Volumetric Pipette 25ml', 'Conical Flask 250ml',
          'Standard Measuring Flask', 'Conductivity Cell Electrode', 'pH Glass Electrode',
          'Silica Crucible', 'Ostwald Viscometer', 'Stalagometer'
        ],
        fineRules: [
          'Burette breakage: ₹250 - ₹500',
          'Pipette breakage: ₹150 - ₹300',
          'Volumetric measuring flask breakage: ₹300 - ₹600',
          'pH / Conductivity cell electrode replacement: ₹1,500 - ₹3,500',
          'Ostwald viscometer capillary crack: ₹400 - ₹800'
        ]
      },
      enabled: true,
      version: '1.0.0'
    });

    // 3. Central Library (LIB)
    this.register({
      departmentCode: 'LIB',
      displayName: 'Central Institutional Library',
      category: 'CENTRAL_DESK',
      assistantInstructions: `You are the specialized AI Assistant for the Central Library at MCE.
You manage borrowed books, overdue book return fines, lost book replacement penalties, and book bank clearances.
Domain Terms: book title, accession number (ACC NO), author, issue date, return due date, overdue fine, lost book fine, library book bank card.
Clearance Rules: All issued textbooks, reference books, and book-bank loans must be returned in good condition. Overdue fines must be cleared before the library clearance is granted.`,
      scannerInstructions: `Extract Central Library overdue and due register records.
Columns: Sl No, USN, Student Name, Book Title / Accession Number, Days Overdue / Lost Status, Fine / Replacement Amount (₹), Date, Remarks.
Keywords: book title, accession no, acc no, overdue, textbook, reference, fine, book bank.`,
      supportedOperations: ['ADD_DUE', 'CLEAR_DUE', 'HOLD', 'LOOKUP_STUDENT', 'CHECK_STATUS', 'LIST_DUES'],
      extractionSchema: {
        recordType: 'LIBRARY_DUE_REGISTER',
        fields: [
          { name: 'usn', label: 'USN', type: 'string', required: true },
          { name: 'studentName', label: 'Student Name', type: 'string', required: false },
          { name: 'bookTitle', label: 'Book Title / Acc No', type: 'string', required: true },
          { name: 'reason', label: 'Fine / Loss Reason', type: 'string', required: true },
          { name: 'amount', label: 'Fine / Replacement Cost (₹)', type: 'number', required: false },
          { name: 'date', label: 'Date', type: 'date', required: false }
        ]
      },
      validationRules: {
        minDueAmount: 1,
        maxDueAmount: 30000,
        requiresReason: true,
        allowedClearanceStatuses: ['PENDING', 'DUE', 'CLEARED', 'ON_HOLD'],
        strictUsnPattern: /^4MC\d{2}[A-Z]{2}\d{3}$/i
      },
      clearanceTarget: 'Central Library Clearance',
      requiredFields: ['usn', 'reason'],
      knowledgeSources: {
        bookCategories: [
          'Engineering Textbooks', 'Technical Reference Volumes', 'Book Bank Scheme',
          'IEEE / ACM Journals', 'Competitive Exam Guides', 'General Fiction & Literature'
        ],
        fineRules: [
          'Standard overdue return fine: ₹2 per day per book after due date',
          'Lost book penalty: Replacement of current edition + ₹100 binding processing fee',
          'Damaged / torn pages: ₹200 - ₹500 depending on volume value',
          'Unreturned book bank set: Full replacement value of issued set'
        ]
      },
      enabled: true,
      version: '1.0.0'
    });

    // 4. Consolidated Laboratory Desk (LAB)
    this.register({
      departmentCode: 'LAB',
      displayName: 'Laboratory Section',
      category: 'LABORATORY',
      assistantInstructions: `You are the AI Assistant for the Consolidated Laboratory Section at MCE.
The Laboratory status represents the consolidated tri-lab institutional clearance (Engineering Physics Lab + Engineering Chemistry Lab + Department Lab).
Clearance Rules: Consolidated Laboratory clearance is CLEARED only when Physics Lab, Chemistry Lab, and the student's Department Lab are ALL cleared with zero dues.`,
      scannerInstructions: `Extract General Laboratory handbook and lab dues records across disciplines.`,
      supportedOperations: ['CHECK_STATUS', 'LOOKUP_STUDENT', 'LIST_DUES'],
      extractionSchema: {
        recordType: 'GENERAL_LAB_REGISTER',
        fields: [
          { name: 'usn', label: 'USN', type: 'string', required: true },
          { name: 'studentName', label: 'Student Name', type: 'string', required: false },
          { name: 'reason', label: 'Lab Particulars', type: 'string', required: true },
          { name: 'amount', label: 'Due Amount (₹)', type: 'number', required: false }
        ]
      },
      validationRules: {
        requiresReason: true,
        allowedClearanceStatuses: ['PENDING', 'DUE', 'CLEARED', 'ON_HOLD'],
        strictUsnPattern: /^4MC\d{2}[A-Z]{2}\d{3}$/i
      },
      clearanceTarget: 'Consolidated Laboratory Clearance',
      requiredFields: ['usn', 'reason'],
      knowledgeSources: {
        policies: [
          'Tri-lab aggregation policy: Physics + Chemistry + Department Lab must all be CLEARED.',
          'If any individual laboratory has DUE, the consolidated Laboratory clearance is DUE.'
        ]
      },
      enabled: true,
      version: '1.0.0'
    });

    // 5. Hostel Warden Section (HST)
    this.register({
      departmentCode: 'HST',
      displayName: 'Hostel Administration / Warden Desk',
      category: 'CENTRAL_DESK',
      assistantInstructions: `You are the specialized AI Assistant for the MCE Hostel Administration.
You manage hostel room clearances, mess bill dues, room fixture/furniture damages, and key returns.
Domain Terms: room inventory, mess dues, electrical fixtures, cot/cupboard damage, key replacement, mess card.
Clearance Rules: Day scholars have NOT_APPLICABLE status. Resident hostellers must clear all monthly mess dues and return room keys with zero damage to receive clearance.`,
      scannerInstructions: `Extract Hostel mess and maintenance due registers.
Columns: Sl No, Room No, USN, Hosteller Name, Mess Due (₹), Maintenance / Damage Details, Due Amount (₹), Status.`,
      supportedOperations: ['ADD_DUE', 'CLEAR_DUE', 'HOLD', 'LOOKUP_STUDENT', 'CHECK_STATUS', 'LIST_DUES'],
      extractionSchema: {
        recordType: 'HOSTEL_DUE_REGISTER',
        fields: [
          { name: 'usn', label: 'USN', type: 'string', required: true },
          { name: 'studentName', label: 'Hosteller Name', type: 'string', required: false },
          { name: 'roomNo', label: 'Room Number', type: 'string', required: false },
          { name: 'reason', label: 'Mess Due / Damage Reason', type: 'string', required: true },
          { name: 'amount', label: 'Outstanding Amount (₹)', type: 'number', required: true }
        ]
      },
      validationRules: {
        minDueAmount: 1,
        maxDueAmount: 100000,
        requiresReason: true,
        allowedClearanceStatuses: ['PENDING', 'DUE', 'CLEARED', 'NOT_APPLICABLE', 'ON_HOLD'],
        strictUsnPattern: /^4MC\d{2}[A-Z]{2}\d{3}$/i
      },
      clearanceTarget: 'Hostel Section Clearance',
      requiredFields: ['usn', 'amount', 'reason'],
      knowledgeSources: {
        fineRules: [
          'Room key replacement: ₹250',
          'Cupboard lock damage: ₹500',
          'Mess card re-issuance: ₹100',
          'Outstanding mess dues: Exact ledger balance'
        ]
      },
      enabled: true,
      version: '1.0.0'
    });

    // 6. Physical Education & Sports Section (SPT)
    this.register({
      departmentCode: 'SPT',
      displayName: 'Physical Education / Sports Section',
      category: 'CENTRAL_DESK',
      assistantInstructions: `You are the specialized AI Assistant for the Physical Education & Sports Department at MCE.
You manage sports equipment issues, team jerseys, gym memberships, and athletic gear returns.
Domain Terms: cricket kit, badminton racket, basketball, football, gym membership fee, sports jersey, athletic spikes.
Clearance Rules: All issued sports gear must be returned to the sports storeroom undamaged. Outstanding tournament or gear dues must be resolved.`,
      scannerInstructions: `Extract Physical Education equipment register and dues logs.
Columns: Sl No, USN, Student Name, Equipment Issued, Return Status, Fine / Damage Amount (₹), Date.`,
      supportedOperations: ['ADD_DUE', 'CLEAR_DUE', 'HOLD', 'LOOKUP_STUDENT', 'CHECK_STATUS', 'LIST_DUES'],
      extractionSchema: {
        recordType: 'SPORTS_EQUIPMENT_REGISTER',
        fields: [
          { name: 'usn', label: 'USN', type: 'string', required: true },
          { name: 'studentName', label: 'Student Name', type: 'string', required: false },
          { name: 'equipment', label: 'Equipment Item', type: 'string', required: true },
          { name: 'reason', label: 'Damage / Loss Detail', type: 'string', required: true },
          { name: 'amount', label: 'Penalty Amount (₹)', type: 'number', required: false }
        ]
      },
      validationRules: {
        minDueAmount: 1,
        maxDueAmount: 20000,
        requiresReason: true,
        allowedClearanceStatuses: ['PENDING', 'DUE', 'CLEARED', 'ON_HOLD'],
        strictUsnPattern: /^4MC\d{2}[A-Z]{2}\d{3}$/i
      },
      clearanceTarget: 'Physical Education Clearance',
      requiredFields: ['usn', 'reason'],
      knowledgeSources: {
        fineRules: [
          'Unreturned badminton racket: ₹800 - ₹2,000',
          'Damaged cricket bat / ball: ₹500 - ₹1,500',
          'Unreturned college team jersey: ₹750',
          'Gym equipment mishandling penalty: ₹300 - ₹1,000'
        ]
      },
      enabled: true,
      version: '1.0.0'
    });

    // 7. Cash / Fee Section (ACC)
    this.register({
      departmentCode: 'ACC',
      displayName: 'Cash / Fee Section',
      category: 'CENTRAL_DESK',
      assistantInstructions: `You are the specialized AI Assistant for the Cash/Fee Section at MCE.
You verify college tuition fee, exam fee, bus transportation fee, and miscellaneous college dues.
Clearance Rules: Financial records must be verified directly against the database ledger. Do not fabricate payments or waive mandatory tuition fees without explicit receipt verification.`,
      scannerInstructions: `Extract Fee Section challan and dues registers.
Columns: Challan / Receipt No, USN, Student Name, Fee Head (Tuition/Exam/Bus), Due Amount (₹), Date, Status.`,
      supportedOperations: ['ADD_DUE', 'CLEAR_DUE', 'HOLD', 'LOOKUP_STUDENT', 'CHECK_STATUS', 'LIST_DUES'],
      extractionSchema: {
        recordType: 'COLLEGE_FEE_REGISTER',
        fields: [
          { name: 'usn', label: 'USN', type: 'string', required: true },
          { name: 'studentName', label: 'Student Name', type: 'string', required: false },
          { name: 'feeHead', label: 'Fee Category', type: 'string', required: true },
          { name: 'reason', label: 'Due Description', type: 'string', required: true },
          { name: 'amount', label: 'Pending Fee (₹)', type: 'number', required: true }
        ]
      },
      validationRules: {
        minDueAmount: 1,
        maxDueAmount: 500000,
        requiresReason: true,
        allowedClearanceStatuses: ['PENDING', 'DUE', 'CLEARED', 'ON_HOLD'],
        strictUsnPattern: /^4MC\d{2}[A-Z]{2}\d{3}$/i
      },
      clearanceTarget: 'Cash/Fee Section Clearance',
      requiredFields: ['usn', 'amount', 'reason'],
      knowledgeSources: {
        policies: [
          'Tuition fee arrears must have zero balance for graduation NDC eligibility.',
          'Bus fee dues are managed under transportation challan records.'
        ]
      },
      enabled: true,
      version: '1.0.0'
    });

    // 8. Academic Branch Departments & Department Laboratories
    const academicBranches: Array<{ code: string; name: string; labItems: string[] }> = [
      { code: 'CS', name: 'Computer Science & Engineering', labItems: ['DBMS Lab', 'Networking Lab', 'Programming Kit', 'Server Access Key'] },
      { code: 'IS', name: 'Information Science & Engineering', labItems: ['DDCO Kit', 'Computer Networks Lab', 'IoT Sensors', 'FPGA Board'] },
      { code: 'AI', name: 'CS & Engineering (AI & ML)', labItems: ['GPU Workstation', 'Robotics Kit', 'Deep Learning Server Account'] },
      { code: 'CB', name: 'Computer Science & Business Systems', labItems: ['Business Analytics Lab', 'ERP Client', 'Workstation Key'] },
      { code: 'EC', name: 'Electronics & Communication Engineering', labItems: ['DSO Oscilloscope', 'Signal Generator', 'DSP Starter Kit', 'Microcontroller Kit'] },
      { code: 'EE', name: 'Electrical & Electronics Engineering', labItems: ['DC Motor Setup', 'Transformers', 'Power Electronics Kit', 'Relay Testing Bench'] },
      { code: 'ET', name: 'Electronics & Computer Engineering', labItems: ['Microprocessor Kit', 'Embedded Systems Board', 'Logic Analyzer'] },
      { code: 'CV', name: 'Civil Engineering', labItems: ['Total Station', 'Theodolite', 'Universal Testing Machine', 'Concrete Compression Tester'] },
      { code: 'ME', name: 'Mechanical Engineering', labItems: ['Lathe Chuck', 'Milling Cutter', 'Heat Transfer Apparatus', 'Hydraulics Test Rig'] },
      { code: 'RA', name: 'Robotics & Artificial Intelligence', labItems: ['Robotic Arm Kit', 'Stepper Motor Driver', 'LiDAR Sensor Module', 'Vision Camera'] },
      { code: 'VL', name: 'Electronics (VLSI Design)', labItems: ['FPGA Evaluation Board', 'EDA Tool License Dongle', 'Cadence Workstation'] }
    ];

    for (const b of academicBranches) {
      this.register({
        departmentCode: b.code,
        displayName: b.name,
        category: 'ACADEMIC_BRANCH',
        assistantInstructions: `You are the specialized AI Assistant for the ${b.name} (${b.code}) Department at MCE.
You manage Departmental Laboratory clearances, specialized laboratory equipment kits, departmental seminar rooms, and branch-specific student dues.
Department Equipment: ${b.labItems.join(', ')}.
Clearance Rules: Students belonging to ${b.code} must resolve all departmental equipment breakages, project loans, and lab clearances before branch sign-off.`,
        scannerInstructions: `Extract Department Laboratory and branch equipment register records for ${b.name} (${b.code}).
Columns: Sl No, USN, Student Name, Laboratory / Kit Name, Damage / Missing Component, Due Amount (₹), Date.`,
        supportedOperations: ['ADD_DUE', 'CLEAR_DUE', 'HOLD', 'LOOKUP_STUDENT', 'CHECK_STATUS', 'LIST_DUES'],
        extractionSchema: {
          recordType: `${b.code}_DEPARTMENT_REGISTER`,
          fields: [
            { name: 'usn', label: 'USN', type: 'string', required: true },
            { name: 'studentName', label: 'Student Name', type: 'string', required: false },
            { name: 'component', label: 'Equipment / Lab Kit', type: 'string', required: true },
            { name: 'reason', label: 'Damage / Dues Reason', type: 'string', required: true },
            { name: 'amount', label: 'Due Amount (₹)', type: 'number', required: false }
          ]
        },
        validationRules: {
          minDueAmount: 1,
          maxDueAmount: 100000,
          requiresReason: true,
          allowedClearanceStatuses: ['PENDING', 'DUE', 'CLEARED', 'ON_HOLD'],
          strictUsnPattern: /^4MC\d{2}[A-Z]{2}\d{3}$/i
        },
        clearanceTarget: `${b.name} Department Clearance`,
        requiredFields: ['usn', 'reason'],
        knowledgeSources: {
          apparatusList: b.labItems,
          fineRules: [
            'Component breakage: Replacement value + 10% administrative processing fee',
            'Unreturned project sensor/kit: Full replacement cost'
          ]
        },
        enabled: true,
        version: '1.0.0'
      });
    }
  }

  public static register(config: DepartmentAgentConfig): void {
    this.registry.set(config.departmentCode.toUpperCase(), config);
  }

  public static getConfig(departmentCode: string): DepartmentAgentConfig | null {
    if (!departmentCode) return null;
    const normalized = departmentCode.trim().toUpperCase();
    return this.registry.get(normalized) || null;
  }

  public static getAllConfigs(): DepartmentAgentConfig[] {
    return Array.from(this.registry.values());
  }

  public static isSupported(departmentCode: string): boolean {
    if (!departmentCode) return false;
    return this.registry.has(departmentCode.trim().toUpperCase());
  }
}
