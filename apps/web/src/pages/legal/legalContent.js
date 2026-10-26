// Legal / policy content. These are working drafts for The Chefs Culinary Academy
// and should be reviewed and approved by the academy (and, where appropriate, a
// legal adviser) before launch. Items in need of confirmation are noted in the
// summary handed to the academy. `body` entries are either strings (paragraphs)
// or { list: [...] } blocks.

export const lastUpdated = '25 October 2026'

export const legalPages = {
  privacy: {
    eyebrow: 'Legal',
    title: 'Privacy policy',
    intro: 'How The Chefs Culinary Academy collects, uses and protects your personal data, in line with the Nigeria Data Protection Act 2023 (NDPA).',
    sections: [
      {
        heading: 'Who we are',
        body: [
          'The Chefs Culinary Arts Ltd Academy ("the academy", "we", "us") is a culinary training school based in Port Harcourt, Nigeria. We are the data controller responsible for the personal data described in this policy.',
          'This policy explains what personal data we collect, why we collect it, how we use and protect it, and the rights you have under the NDPA.',
        ],
      },
      {
        heading: 'Information we collect',
        body: [
          'We collect personal data that you provide to us and data generated when you interact with our website and programmes, including:',
          { list: [
            'Identity and contact details — your name, date of birth, gender, phone number, email and home address.',
            'Application information — your education background, cooking experience, programme of interest and any supporting documents (such as a valid ID, passport photograph or sponsorship letter).',
            'Enrolment and academic records — your programme, attendance, assessments, results and certificates.',
            'Payment information — records of fees and payments (card and bank details are handled by our payment providers, not stored by us).',
            'Website and enquiry data — messages you send us, newsletter sign-ups, and basic technical data such as your device and browser.',
          ] },
        ],
      },
      {
        heading: 'How we use your data',
        body: [
          'We use your personal data to:',
          { list: [
            'Process your application and manage admissions.',
            'Deliver our programmes and keep your academic records.',
            'Communicate with you about your application, classes, events and account.',
            'Process fees and issue receipts and certificates.',
            'Verify certificates on request from employers.',
            'Meet our legal, regulatory and accounting obligations.',
            'Improve our website and services.',
          ] },
        ],
      },
      {
        heading: 'Lawful basis for processing',
        body: [
          'Under the NDPA, we process your data on one or more of the following bases: your consent; the performance of a contract with you (such as your enrolment); compliance with a legal obligation; and our legitimate interests in running the academy, provided these do not override your rights.',
        ],
      },
      {
        heading: 'Sharing your data',
        body: [
          'We do not sell your personal data. We may share it only where necessary with:',
          { list: [
            'Payment processors, to collect fees securely.',
            'Sponsors and training schemes (for example SUPA ITF) where you apply as a sponsored trainee.',
            'Service providers who help us operate (such as hosting and communications), under confidentiality obligations.',
            'Authorities or regulators where we are required to by law.',
          ] },
        ],
      },
      {
        heading: 'How long we keep your data',
        body: [
          'We keep your personal data for as long as necessary to provide our services, maintain your academic and certificate records, and meet our legal and accounting obligations. When data is no longer needed, we delete or anonymise it securely.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'Under the NDPA, you have the right to:',
          { list: [
            'Access the personal data we hold about you.',
            'Request correction of inaccurate or incomplete data.',
            'Request deletion of your data in certain circumstances.',
            'Object to or restrict certain processing.',
            'Request a copy of your data in a portable format.',
            'Withdraw consent at any time, without affecting processing already carried out.',
          ] },
          'To exercise any of these rights, contact us using the details below. You also have the right to lodge a complaint with the Nigeria Data Protection Commission (NDPC).',
        ],
      },
      {
        heading: 'Keeping your data safe',
        body: [
          'We use appropriate organisational and technical measures to protect your personal data against loss, misuse and unauthorised access. Access to your records is limited to staff who need it to do their work.',
        ],
      },
      {
        heading: 'Children and minors',
        body: [
          'Where an applicant is a minor, we require the consent of a parent or guardian and may request additional information. We only collect data about minors that is necessary for their training and welfare.',
        ],
      },
      {
        heading: 'Changes to this policy',
        body: [
          'We may update this policy from time to time. The latest version will always be available on this page, with the date it was last updated shown above.',
        ],
      },
    ],
  },

  terms: {
    eyebrow: 'Legal',
    title: 'Terms & conditions',
    intro: 'The terms on which you use our website and enrol in our programmes at The Chefs Culinary Academy.',
    sections: [
      {
        heading: 'Acceptance of these terms',
        body: [
          'By using this website, applying for a programme or enrolling with The Chefs Culinary Academy, you agree to these terms and conditions. If you do not agree, please do not use our services.',
        ],
      },
      {
        heading: 'Our programmes',
        body: [
          'We offer professional cookery programmes, sponsored cohorts and short courses, combining theory with hands-on practical training. Programme details — including duration and schedule — are described on our website and may be updated from time to time.',
          'Classes are typically held three days a week (Monday, Wednesday and Friday). Specific session times are confirmed with each cohort.',
        ],
      },
      {
        heading: 'Applications and admission',
        body: [
          'Submitting an application does not guarantee a place. We review each application and will contact you with the outcome and next steps. A place is confirmed once enrolment is completed and any required fees are paid.',
          'You are responsible for providing accurate and complete information. Giving false information may lead to withdrawal of an offer or place.',
        ],
      },
      {
        heading: 'Fees and payment',
        body: [
          'Fees vary by programme and are shared on request. Fees must be paid as agreed at enrolment. Refunds are governed by our Refund Policy.',
        ],
      },
      {
        heading: 'Your responsibilities as a student',
        body: [
          'As a student, you agree to:',
          { list: [
            'Attend classes and meet the attendance and academic requirements set out in our Academic Rules.',
            'Follow kitchen safety, hygiene and conduct rules at all times.',
            'Treat staff, fellow students and academy property with respect.',
            'Wear the required uniform and come prepared for practical sessions.',
          ] },
        ],
      },
      {
        heading: 'Learning materials and intellectual property',
        body: [
          'Handbooks, workbooks, recipes and other materials we provide are for your personal learning only. They remain our property (or that of their owners) and may not be copied, resold or redistributed without permission.',
        ],
      },
      {
        heading: 'Certificates',
        body: [
          'A Certificate of Completion is issued to students who complete their programme and meet the assessment requirements. Certificates can be confirmed through our certificate verification.',
        ],
      },
      {
        heading: 'Changes and cancellations',
        body: [
          'We may occasionally change programme content, schedules or instructors, or reschedule or cancel a class or cohort. Where we cancel a programme, the Refund Policy applies.',
        ],
      },
      {
        heading: 'Liability',
        body: [
          'We take reasonable care in delivering our programmes. To the extent permitted by law, we are not liable for indirect or consequential loss. Nothing in these terms limits liability that cannot be excluded under Nigerian law.',
        ],
      },
      {
        heading: 'Governing law',
        body: [
          'These terms are governed by the laws of the Federal Republic of Nigeria, and any disputes are subject to the jurisdiction of the Nigerian courts.',
        ],
      },
    ],
  },

  refunds: {
    eyebrow: 'Legal',
    title: 'Refund policy',
    intro: 'When and how fees may be refunded for programmes at The Chefs Culinary Academy.',
    sections: [
      {
        heading: 'Scope',
        body: [
          'This policy explains how refunds are handled for tuition and programme fees. It forms part of our Terms & Conditions. The specific windows and amounts below are proposed defaults and are confirmed at enrolment.',
        ],
      },
      {
        heading: 'Before your programme starts',
        body: [
          { list: [
            'If you withdraw more than seven (7) days before your programme start date, you are entitled to a refund of fees paid, less a non-refundable registration fee.',
            'If you withdraw within seven (7) days of the start date, a portion of your fees may be retained to cover costs already incurred.',
          ] },
        ],
      },
      {
        heading: 'After your programme starts',
        body: [
          'Once a programme has started, refunds are limited. Any refund is calculated on a pro-rata basis for the portion of the programme not yet delivered, at the academy’s discretion. No refund is available once a significant portion of the programme has been completed.',
        ],
      },
      {
        heading: 'Non-refundable items',
        body: [
          'Certain items are non-refundable once issued or incurred, including registration fees, handbooks and workbooks, uniforms and consumables.',
        ],
      },
      {
        heading: 'If we cancel',
        body: [
          'If the academy cancels a programme or cohort before it starts, you are entitled to a full refund of fees paid, or the option to transfer to another intake.',
        ],
      },
      {
        heading: 'Sponsored trainees',
        body: [
          'For students funded through a sponsor or scheme (such as SUPA ITF), refunds are handled in line with the agreement between the academy and the sponsor.',
        ],
      },
      {
        heading: 'How to request a refund',
        body: [
          'To request a refund, contact us in writing using the details below, stating your name, programme and reason for withdrawal. Approved refunds are processed to your original payment method within a reasonable period after approval.',
        ],
      },
    ],
  },

  'academic-rules': {
    eyebrow: 'Legal',
    title: 'Academic rules',
    intro: 'The academic standards, assessment and conduct expected of students at The Chefs Culinary Academy.',
    sections: [
      {
        heading: 'Attendance',
        body: [
          'Practical training is central to our programmes, so regular attendance is essential. Classes are held three days a week (Monday, Wednesday and Friday). Students are expected to attend all sessions, arrive on time and inform the academy in advance of any absence.',
          'Persistent absence may affect your assessments, your eligibility to graduate and the issuing of your certificate.',
        ],
      },
      {
        heading: 'Assessment and grading',
        body: [
          'Students are assessed on both practical skills and theory. Each course is marked out of 100 — up to 70 marks for practical work (such as cooking techniques, recipe execution and kitchen safety) and up to 30 marks for theory.',
          'Grades are awarded as follows:',
          { list: [
            'A — 90 to 100 (Excellent)',
            'B — 80 to 89 (Very good)',
            'C — 70 to 79 (Good)',
            'D — 60 to 69 (Pass)',
            'F — below 60 (Fail)',
          ] },
        ],
      },
      {
        heading: 'Completion and certification',
        body: [
          'To complete a programme and receive a Certificate of Completion, students must meet the attendance requirement, complete the required assessments and project work, and settle any outstanding fees.',
        ],
      },
      {
        heading: 'Kitchen safety and hygiene',
        body: [
          'Food safety and hygiene are non-negotiable. Students must follow all safety and sanitation rules, wear the required uniform, and handle equipment and ingredients responsibly. Unsafe conduct may result in removal from a practical session.',
        ],
      },
      {
        heading: 'Academic honesty',
        body: [
          'Students are expected to do their own work. Cheating, plagiarism or misrepresentation in assessments is taken seriously and may result in loss of marks or other disciplinary action.',
        ],
      },
      {
        heading: 'Conduct and discipline',
        body: [
          'Students must treat instructors, fellow students, staff and academy property with respect. Serious or repeated misconduct may lead to warnings, suspension or, in serious cases, dismissal from the programme.',
        ],
      },
      {
        heading: 'Appeals',
        body: [
          'If you believe an assessment result or disciplinary decision is unfair, you may raise it with the academy in writing. We will review the matter and respond.',
        ],
      },
    ],
  },
}

export const legalOrder = ['privacy', 'terms', 'refunds', 'academic-rules']

export const legalSlugToPath = {
  privacy: '/legal/privacy',
  terms: '/legal/terms',
  refunds: '/legal/refunds',
  'academic-rules': '/legal/academic-rules',
}
