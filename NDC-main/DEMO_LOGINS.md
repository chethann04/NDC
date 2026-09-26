# 🔑 No Due Certificate (NDC) System - Demo Login Credentials

This document contains all pre-configured demo user accounts and login credentials for testing the **College No Due Certificate (NDC) Management System**.

---

## 🚀 Quick Fill Demo Accounts (Key Roles & Laboratory Architecture)

| Role / Category | Unit / Department | Login ID | Email / Username | Default Password | Primary Scope & Access |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **🔬 Physics Lab** | Engineering Physics Laboratory | `PHY001` | `physics.lab@mce.ac.in` | `Officer@123` | Physics Lab apparatus, handbook clearances |
| **🧪 Chemistry Lab** | Engineering Chemistry Laboratory | `CHEM001` | `chemistry.lab@mce.ac.in` | `Officer@123` | Chemistry Lab glassware, chemicals, manual clearances |
| **💻 ISE Faculty / Lab** | Information Science & Engineering | `ISE001` | `ise.officer@mce.ac.in` | `Officer@123` | ISE Department Desk + Labs (`IS-DDCO`, `IS-TL1-3`) |
| **💻 CSE Faculty / Lab** | Computer Science & Engineering | `CSE001` | `cse.officer@mce.ac.in` | `Officer@123` | CSE Department Desk + Labs (`CS-PROG`, `CS-DBMS`, `CS-NET`) |
| **🧑‍🏫 CSE HOD** | Computer Science & Engineering | `HOD-CS` | `hod.cs@mce.ac.in` | `Officer@123` | CS Academic Dept Overview & Clearance History |
| **🧑‍🏫 ISE HOD** | Information Science & Engineering | `HOD-IS` | `hod.is@mce.ac.in` | `Officer@123` | IS Academic Dept Overview & Clearance History |
| **👑 Super Admin** | Central System Administration | `SUPERADMIN` | `superadmin@mce.ac.in` | `Admin@123` | Full system control, audit logs, user management |
| **📚 Central Library** | Central Institutional Library | `LIB001` | `library@mce.ac.in` | `Officer@123` | Library books & fine clearances |
| **🎓 Student (Demo)** | Information Science (Sem 8) | `4MC22IS001` | `chethuc809@gmail.com` | DOB: `15/05/2004` | Student NDC portal & certificate tracking |

---

## 👑 1. System Administration & Management

| Role | Name | Email / Username | Default Password | Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | Super Administrator | `superadmin@mce.ac.in` | `Admin@123` | Full System Control, Audits, User Management, Department Setup, Emergency Overrides |
| **System Admin** | System Administrator (Admin Block) | `admin@mce.ac.in` | `Admin@123` | System Management, Bulk Student Import, Settings & Certificate Management (Clearance Status Review: No) |

---

## 🏢 2. Designated Clearance Department Officers (Status Review & Verification)

All clearance officer accounts share the default password: **`Officer@123`**.
Clearance status review, verification, and status updates (No Due / Due) are strictly restricted to these designated desks:

| Department | Officer Name | Employee ID | Login Email | Default Password | Review Permission |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Central Library** | Central Library Officer | `EMP-LIB-01` | `library@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |
| **Physics Lab** | Physics Laboratory In-charge | `EMP-PHY-01` (`PHY001`) | `physics.lab@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |
| **Chemistry Lab** | Chemistry Laboratory In-charge | `EMP-CHEM-01` (`CHEM001`) | `chemistry.lab@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |
| **Laboratory Section** | Laboratory In-charge Officer | `EMP-LAB-01` | `lab@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |
| **Hostel Section** | Hostel Warden | `EMP-HST-01` | `hostel@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |
| **Sports / PE** | Sports Officer | `EMP-SPT-01` | `sports@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |
| **Cash/Fee Section (Officer 1)** | Cash/Fee Officer 1 | `EMP-ACC-01` | `cashfee1@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |
| **Cash/Fee Section (Officer 2)** | Cash/Fee Officer 2 | `EMP-ACC-02` | `cashfee2@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |
| **Cash/Fee Section (Officer 3)** | Cash/Fee Officer 3 | `EMP-ACC-03` | `cashfee3@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |
| **Cash/Fee Section (In-charge)** | Cash/Fee Section In-charge | `EMP-ACC-00` | `accounts@mce.ac.in` | `Officer@123` | **Yes (Authorized)** |

---

## 🏛️ 2.1 College Office / Institutional Administration

| Department | Officer Name | Employee ID | Login Email | Default Password | Review Permission |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **College Office / Administrative Section** | Administrative Office In-charge | `EMP-ADM-01` | `office@mce.ac.in` | `Officer@123` | **No (Institutional Overview Only)** |

---

## 🎓 3. Academic Faculty & HOD Desks (All 11 MCE Departments)

All academic faculty and HOD accounts share the default password: **`Officer@123`**

| Department | Code | Role | Name | Employee ID | Login Email | Default Password |
| :--- | :---: | :---: | :--- | :--- | :--- | :--- |
| **Computer Science & Engg** | CS | **HOD** | Head of Department (CSE) | `EMP-HOD-CS-01` | `hod.cs@mce.ac.in` | `Officer@123` |
| **Computer Science & Engg** | CS | **Faculty** | Department Faculty (CSE) | `EMP-FAC-CS-01` | `faculty.cs@mce.ac.in` | `Officer@123` |
| **CS & Engg (AI & ML)** | AI | **HOD** | Head of Department (AI & ML) | `EMP-HOD-AI-01` | `hod.ai@mce.ac.in` | `Officer@123` |
| **CS & Engg (AI & ML)** | AI | **Faculty** | Department Faculty (AI & ML) | `EMP-FAC-AI-01` | `faculty.ai@mce.ac.in` | `Officer@123` |
| **CS & Business Systems** | CB | **HOD** | Head of Department (CSBS) | `EMP-HOD-CB-01` | `hod.cb@mce.ac.in` | `Officer@123` |
| **CS & Business Systems** | CB | **Faculty** | Department Faculty (CSBS) | `EMP-FAC-CB-01` | `faculty.cb@mce.ac.in` | `Officer@123` |
| **Robotics & AI** | RA | **HOD** | Head of Department (Robotics & AI) | `EMP-HOD-RA-01` | `hod.ra@mce.ac.in` | `Officer@123` |
| **Robotics & AI** | RA | **Faculty** | Department Faculty (Robotics & AI) | `EMP-FAC-RA-01` | `faculty.ra@mce.ac.in` | `Officer@123` |
| **Electronics & Comm Engg** | EC | **HOD** | Head of Department (ECE) | `EMP-HOD-EC-01` | `hod.ec@mce.ac.in` | `Officer@123` |
| **Electronics & Comm Engg** | EC | **Faculty** | Department Faculty (ECE) | `EMP-FAC-EC-01` | `faculty.ec@mce.ac.in` | `Officer@123` |
| **Electronics Engg (VLSI)** | VL | **HOD** | Head of Department (VLSI) | `EMP-HOD-VL-01` | `hod.vl@mce.ac.in` | `Officer@123` |
| **Electronics Engg (VLSI)** | VL | **Faculty** | Department Faculty (VLSI) | `EMP-FAC-VL-01` | `faculty.vl@mce.ac.in` | `Officer@123` |
| **Electronics & Computer Engg** | ET | **HOD** | Head of Department (Electronics & Computer) | `EMP-HOD-ET-01` | `hod.et@mce.ac.in` | `Officer@123` |
| **Electronics & Computer Engg** | ET | **Faculty** | Department Faculty (Electronics & Computer) | `EMP-FAC-ET-01` | `faculty.et@mce.ac.in` | `Officer@123` |
| **Electrical & Electronics Engg** | EE | **HOD** | Head of Department (EEE) | `EMP-HOD-EE-01` | `hod.ee@mce.ac.in` | `Officer@123` |
| **Electrical & Electronics Engg** | EE | **Faculty** | Department Faculty (EEE) | `EMP-FAC-EE-01` | `faculty.ee@mce.ac.in` | `Officer@123` |
| **Civil Engineering** | CV | **HOD** | Head of Department (Civil) | `EMP-HOD-CV-01` | `hod.cv@mce.ac.in` | `Officer@123` |
| **Civil Engineering** | CV | **Faculty** | Department Faculty (Civil) | `EMP-FAC-CV-01` | `faculty.cv@mce.ac.in` | `Officer@123` |
| **Mechanical Engineering** | ME | **HOD** | Head of Department (Mechanical) | `EMP-HOD-ME-01` | `hod.me@mce.ac.in` | `Officer@123` |
| **Mechanical Engineering** | ME | **Faculty** | Department Faculty (Mechanical) | `EMP-FAC-ME-01` | `faculty.me@mce.ac.in` | `Officer@123` |
| **Information Science & Engg** | IS | **HOD** | Head of Department (ISE) | `EMP-HOD-IS-01` | `hod.is@mce.ac.in` | `Officer@123` |
| **Information Science & Engg** | IS | **Faculty** | Department Faculty (ISE) | `EMP-FAC-IS-01` | `faculty.is@mce.ac.in` | `Officer@123` |

---

## 👨‍🎓 4. Dedicated Student Portal Login (`/student-login`)

Students have a dedicated login portal accessible at:
👉 **`http://localhost:5173/student-login`**

Students sign in using their **University Seat Number (USN)** and their registered **Date of Birth (DOB)**.
- Default Date of Birth for demo accounts: **`15/05/2004`** (or calendar date **`15-May-2004`** / `2004-05-15`).
- Supported formats: HTML5 Date picker, `DD/MM/YYYY`, `YYYY-MM-DD`.

### 💻 Computer Science & Engineering (CS)
| USN | Student Name | Section | Batch | Date of Birth | Login Portal URL |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `4MC22CS001` | Aarav Sharma | A | 2022-2026 | `15/05/2004` | `/student-login` |
| `4MC22CS002` | Ananya Rao | A | 2022-2026 | `15/05/2004` | `/student-login` |
| `4MC22CS003` | Rohan Verma | A | 2022-2026 | `15/05/2004` | `/student-login` |
| `4MC22CS004` | Priyesha Patel | B | 2022-2026 | `15/05/2004` | `/student-login` |
| `4MC22CS005` | Vikramaditya Singh | B | 2022-2026 | `15/05/2004` | `/student-login` |

### ℹ️ Information Science & Engineering (IS)
| USN | Student Name | Section | Batch | Login Email | Default Password |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `4MC22IS001` | TEST (Active Test Student) | A | 2022-2026 | `chethuc809@gmail.com` | `4MC22IS001` |
| `4MC22IS001` | Chirag Gowda | A | 2022-2026 | `chirag.gowda@example.com` | `4MC22IS001` |
| `4MC22IS002` | Pooja Joshi | A | 2022-2026 | `pooja.joshi@example.com` | `4MC22IS002` |
| `4MC22IS003` | Varun Deshmukh | A | 2022-2026 | `varun.deshmukh@example.com` | `4MC22IS003` |
| `4MC22IS004` | Meghana Iyer | B | 2022-2026 | `meghana.iyer@example.com` | `4MC22IS004` |
| `4MC22IS005` | Siddharth Mehta | B | 2022-2026 | `siddharth.mehta@example.com` | `4MC22IS005` |

### ⚡ Electronics & Communication Engg (EC)
| USN | Student Name | Section | Batch | Login Email | Default Password |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `4MC22EC001` | Abhinav Nambiar | A | 2022-2026 | `abhinav.nambiar@example.com` | `4MC22EC001` |
| `4MC22EC002` | Rashmi Menon | A | 2022-2026 | `rashmi.menon@example.com` | `4MC22EC002` |
| `4MC22EC003` | Darshan Pai | A | 2022-2026 | `darshan.pai@example.com` | `4MC22EC003` |

### 🤖 Artificial Intelligence & Machine Learning (AI)
| USN | Student Name | Section | Batch | Login Email | Default Password |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `4MC22AI001` | Yashwant G | A | 2022-2026 | `yashwant.g@example.com` | `4MC22AI001` |
| `4MC22AI002` | Tanvi Bhatia | A | 2022-2026 | `tanvi.bhatia@example.com` | `4MC22AI002` |

### ⚙️ Mechanical Engineering (ME)
| USN | Student Name | Section | Batch | Login Email | Default Password |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `4MC22ME001` | Bharath Kumar | A | 2022-2026 | `bharath.k@example.com` | `4MC22ME001` |
| `4MC22ME002` | Archana N | A | 2022-2026 | `archana.n@example.com` | `4MC22ME002` |

### 🏗️ Civil Engineering (CV)
| USN | Student Name | Section | Batch | Login Email | Default Password |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `4MC22CV001` | Hemanth R | A | 2022-2026 | `hemanth.r@example.com` | `4MC22CV001` |
| `4MC22CV002` | Indu K | A | 2022-2026 | `indu.k@example.com` | `4MC22CV002` |

---

## 🛠️ How to Reset or Reseed Database

To seed/re-seed all default admin, clearance officer, and academic faculty accounts in the database, run the following command in the `server` directory:

```bash
npm run seed
```
