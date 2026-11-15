Attribute VB_Name = "modClosingImport"
Option Compare Database
Option Explicit

' =====================================================================
'  Smart Queue  ->  CASES table  (the web 'Clinic closing' is the source)
'
'  1) Paste this module (Alt+F11 -> Insert -> Module), put the SAME
'     token you use in modQueueCall (QUEUE_API_TOKEN from Vercel).
'  2) In the form "Cases" add a button  "Import from Web"  with
'     On Click:  =ClosingImport()
'  The button copies the closing saved on the website for the date in
'  [Date of Work] (or today's clinic date if empty) into CASES:
'  updates the row of that date if it exists, otherwise adds a new row.
'  Net Number / NetFees / Grand Net are calculated fields -> not written.
' =====================================================================

Private Const CL_URL    As String = "https://call-patients-order.vercel.app/api/integrations/closing"
Private Const CL_TOKEN  As String = "PASTE_QUEUE_API_TOKEN"
Private Const CL_CLINIC As String = "heliopolis"     ' "heliopolis" | "toukh" | "auto" (= open session)

Public Function ClosingImport(Optional ByVal workDate As Variant) As Boolean
    Dim d As Date, kv As Object, rs As DAO.Recordset, isNew As Boolean, frm As Form
    On Error GoTo EH

    ' --- which date ---------------------------------------------------
    If IsMissing(workDate) Or IsNull(workDate) Or IsEmpty(workDate) Then
        On Error Resume Next
        Set frm = Screen.ActiveForm
        If Not frm Is Nothing Then workDate = frm.Controls("Date of Work").Value
        On Error GoTo EH
    End If
    If IsNull(workDate) Or IsEmpty(workDate) Or Not IsDate(workDate) Then
        If Hour(Now()) < 8 Then d = Date - 1 Else d = Date     ' clinic day changes at 08:00
    Else
        d = CDate(workDate)
    End If

    ' --- read from the website ------------------------------------------
    Set kv = FetchClosing(d)
    If kv Is Nothing Then Exit Function
    If kv("ok") <> "1" Then
        If kv("error") = "not_saved" Then
            MsgBox "No closing saved on the website for " & Format(d, "dd/mm/yyyy") & "." & vbCrLf & _
                   "Website: Day summary -> Clinic closing -> Save.", vbExclamation, "Import"
        Else
            MsgBox "Error: " & kv("error"), vbExclamation, "Import"
        End If
        Exit Function
    End If

    ' --- write into CASES ----------------------------------------------
    Set rs = CurrentDb.OpenRecordset("CASES", dbOpenDynaset)
    rs.FindFirst "[Date of Work] = #" & Format(d, "mm\/dd\/yyyy") & "#"
    isNew = rs.NoMatch
    If isNew Then
        If MsgBox("Add a new CASES row for " & Format(d, "dd/mm/yyyy") & " ?", vbQuestion + vbOKCancel, "Import") <> vbOK Then GoTo Done
        rs.AddNew
        rs![No] = Nz(DMax("[No]", "CASES"), 0) + 1
        rs![Date of Work] = d
    Else
        If MsgBox("A row for " & Format(d, "dd/mm/yyyy") & " already exists (No " & rs![No] & ")." & vbCrLf & _
                  "Replace it with the website closing?", vbQuestion + vbOKCancel, "Import") <> vbOK Then GoTo Done
        rs.Edit
    End If
    rs![No of Cases] = Val(kv("no_cases"))
    rs![Fees Back] = Val(kv("fees_back"))
    rs![Fees] = Val(kv("fees"))
    rs![Mohamed Day] = Val(kv("mohamed_day"))
    rs![Mohamed Salary] = Val(kv("mohamed_salary"))
    rs![Mohamed Clean] = Val(kv("mohamed_clean"))
    rs![Naser Clean] = Val(kv("naser_clean"))
    rs![Bawab and Mentainace] = Val(kv("bawab"))
    rs![Parking] = Val(kv("parking"))
    rs![Electricity and Gas] = Val(kv("electricity"))
    rs![Running Cost] = Val(kv("running"))
    rs![Tukh] = Val(kv("tukh"))
    rs![Others] = Val(kv("others"))
    rs![NotesofOther] = Left$(kv("notes_other"), 255)
    rs![Notes] = Left$(kv("notes"), 255)
    rs![DailyReport] = kv("report")
    rs.Update
    ClosingImport = True

    ' --- show it ---------------------------------------------------------
    On Error Resume Next
    If Not frm Is Nothing Then
        frm.Requery
        frm.Recordset.FindFirst "[Date of Work] = #" & Format(d, "mm\/dd\/yyyy") & "#"
    End If
    On Error GoTo EH
    MsgBox IIf(isNew, "Added ", "Updated ") & Format(d, "dd/mm/yyyy") & vbCrLf & _
           "Grand Net = " & kv("grand_net"), vbInformation, "Import"
Done:
    rs.Close
    Exit Function
EH:
    MsgBox "Import failed: " & Err.Description, vbExclamation, "Import"
End Function

' GET the closing as key=value lines -> Dictionary
Private Function FetchClosing(ByVal d As Date) As Object
    Dim x As Object, kv As Object, ln As Variant, p As Long, body As String
    On Error GoTo EH
    Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    x.setTimeouts 5000, 5000, 20000, 20000
    x.Open "GET", CL_URL & "?clinic=" & CL_CLINIC & "&date=" & Format(d, "yyyy-mm-dd"), False
    x.setRequestHeader "X-Queue-Token", CL_TOKEN
    x.send
    If x.Status = 401 Then MsgBox "Wrong token (CL_TOKEN).", vbExclamation, "Import": Exit Function
    body = x.responseText
    Set kv = CreateObject("Scripting.Dictionary")
    kv.CompareMode = vbTextCompare
    For Each ln In Split(Replace(body, vbCr, ""), vbLf)
        p = InStr(1, ln, "=")
        If p > 1 Then kv(Left$(ln, p - 1)) = Mid$(ln, p + 1)
    Next
    If Not kv.Exists("ok") Then kv("ok") = "0": kv("error") = "HTTP " & x.Status
    If Not kv.Exists("error") Then kv("error") = ""
    Set FetchClosing = kv
    Exit Function
EH:
    MsgBox "Cannot reach the website: " & Err.Description, vbExclamation, "Import"
End Function
