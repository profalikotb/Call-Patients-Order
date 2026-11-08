Attribute VB_Name = "modQueueCall"
Option Compare Database
Option Explicit

' =====================================================================
'  MS Access  ->  Smart Queue (call-patients-order.vercel.app)
'  One click in Access = the TV in the waiting room calls the patient.
'
'  Button examples (On Click property or VBA):
'     =QueueCallNext()                    next patient in the queue
'     =QueueCallBooking([NUMBER10])       THIS patient (current record)
'     =QueueCallSelected()                THIS patient, list in a subform
'     =QueueRepeat()                      repeat the current call
'     =QueueInRoom()  /  =QueueDone()     patient entered / finished
'
'  QUEUE_CLINIC = "auto" -> Friday = Toukh, other days = Heliopolis
'
'  Desktop push (Oracle -> app, no Google Sheet):
'  pressing "call" on a PC makes THAT PC's Oracle the list source.
'  The first press after switching PCs can take ~10 s (the PC sends its list).
' =====================================================================

Private Const QUEUE_URL    As String = "https://call-patients-order.vercel.app/api/integrations/call"
Private Const QUEUE_TOKEN  As String = "PASTE_QUEUE_API_TOKEN"     ' same value as QUEUE_API_TOKEN in Vercel
Private Const QUEUE_CLINIC As String = "auto"                      ' "auto" | "toukh" | "heliopolis"
Private Const SHOW_POPUP   As Boolean = False                      ' True = confirmation box after each call

Public Function QueueCallNext() As Boolean
    QueueCallNext = QueueSend("call_next", "")
End Function

Public Function QueueCallBooking(ByVal bookingId As Variant) As Boolean
    If IsNull(bookingId) Or Trim$(Nz(bookingId, "")) = "" Then
        MsgBox "No booking number on the current record.", vbExclamation, "Smart Queue"
        Exit Function
    End If
    QueueCallBooking = QueueSend("call", CStr(bookingId))
End Function

' Button "call THIS patient" on a form whose list is in a SUBFORM:  On Click  =QueueCallSelected()
' Finds the booking number (NUMBER10) of the selected row in the form or any of its subforms.
Public Function QueueCallSelected(Optional ByVal fieldName As String = "NUMBER10") As Boolean
    Dim v As Variant, where As String
    On Error Resume Next
    v = FindBookingNo(Screen.ActiveForm, fieldName, where)
    On Error GoTo 0
    If IsEmpty(v) Then
        MsgBox "Could not find the field " & fieldName & " in this form or its subforms." & vbCrLf & _
               "Fields seen: " & where, vbExclamation, "Smart Queue"
        Exit Function
    End If
    If IsNull(v) Or Trim$(Nz(v, "")) = "" Then
        MsgBox "Select a patient row in the list first.", vbExclamation, "Smart Queue"
        Exit Function
    End If
    QueueCallSelected = QueueSend("call", CStr(v))
End Function

' Returns Empty when the field does not exist; Null when no row is selected.
Private Function FindBookingNo(ByVal frm As Form, ByVal fieldName As String, ByRef seen As String) As Variant
    Dim ctl As Control, v As Variant, i As Integer
    FindBookingNo = Empty
    ' 1) a control with that name on this form
    On Error Resume Next
    v = frm.Controls(fieldName).Value
    If Err.Number = 0 Then FindBookingNo = v: Exit Function
    Err.Clear
    ' 2) a field in this form's records (works even if the column is hidden)
    v = frm.Recordset.Fields(fieldName).Value
    If Err.Number = 0 Then
        If frm.Recordset.EOF Or frm.Recordset.BOF Then FindBookingNo = Null Else FindBookingNo = v
        Exit Function
    End If
    Err.Clear
    Dim n As Integer: n = -1
    n = frm.Recordset.Fields.Count          ' stays -1 for an unbound form
    Err.Clear
    For i = 0 To n - 1
        If Len(seen) < 250 Then seen = seen & frm.Name & "." & frm.Recordset.Fields(i).Name & " "
    Next i
    Err.Clear
    ' 3) every subform on this form
    For Each ctl In frm.Controls
        If ctl.ControlType = acSubform Then
            v = Empty
            v = FindBookingNo(ctl.Form, fieldName, seen)
            If Err.Number = 0 And Not IsEmpty(v) Then FindBookingNo = v: Exit Function
            Err.Clear
        End If
    Next ctl
End Function

' One-time repair: every button in every form whose On Click is =QueueCallBooking(...)
' becomes =QueueCallSelected()  (works when the list is in a subform).
' Run once in the Immediate window (Ctrl+G):   QueueFixButtons
Public Sub QueueFixButtons()
    Dim ao As AccessObject, frm As Form, ctl As Control, n As Long, wasOpen As Boolean
    For Each ao In CurrentProject.AllForms
        wasOpen = ao.IsLoaded
        If wasOpen Then DoCmd.Close acForm, ao.Name, acSaveYes
        DoCmd.OpenForm ao.Name, acDesign, , , , acHidden
        Set frm = Forms(ao.Name)
        Dim changed As Boolean: changed = False
        For Each ctl In frm.Controls
            If ctl.ControlType = acCommandButton Then
                If InStr(1, ctl.OnClick, "QueueCallBooking", vbTextCompare) > 0 Then
                    Debug.Print ao.Name & " / " & ctl.Name & " : " & ctl.OnClick & "  ->  =QueueCallSelected()"
                    ctl.OnClick = "=QueueCallSelected()"
                    n = n + 1: changed = True
                End If
            End If
        Next ctl
        DoCmd.Close acForm, ao.Name, IIf(changed, acSaveYes, acSaveNo)
        If wasOpen Then DoCmd.OpenForm ao.Name
    Next ao
    MsgBox n & " button(s) fixed.", vbInformation, "Smart Queue"
End Sub

Public Function QueueRepeat() As Boolean
    QueueRepeat = QueueSend("repeat", "")
End Function

Public Function QueueInRoom() As Boolean
    QueueInRoom = QueueSend("in_room", "")
End Function

Public Function QueueDone() As Boolean
    QueueDone = QueueSend("done", "")
End Function

' ---------------------------------------------------------------------
Private Function QueueSend(ByVal action As String, ByVal bookingId As String) As Boolean
    On Error GoTo EH
    Dim x As Object, body As String, resp As String, num As String, nm As String

    body = "{""clinic"":""" & QUEUE_CLINIC & """,""action"":""" & action & """" & _
           IIf(bookingId <> "", ",""booking_id"":""" & bookingId & """", "") & _
           ",""host"":""" & JEsc(Environ$("COMPUTERNAME")) & """" & _
           ",""actor"":""" & JEsc(CurrentUserLabel()) & """}"

    DoCmd.Hourglass True
    Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    x.setTimeouts 5000, 5000, 35000, 35000        ' up to ~30 s when the list switches to this PC
    x.Open "POST", QUEUE_URL, False
    x.setRequestHeader "Content-Type", "application/json; charset=utf-8"
    x.setRequestHeader "X-Queue-Token", QUEUE_TOKEN
    x.send body
    resp = x.responseText
    DoCmd.Hourglass False

    If x.Status = 200 And InStr(resp, """ok"":true") > 0 Then
        num = JVal(resp, "number"): nm = JVal(resp, "name")
        Debug.Print Format$(Now, "hh:nn AM/PM"), "Queue " & action & " OK -> #" & num & " " & nm
        If SHOW_POPUP Then MsgBox "Called number " & num & IIf(nm <> "", vbCrLf & nm, ""), vbInformation, "Smart Queue"
        QueueSend = True
    Else
        MsgBox "Call failed (" & x.Status & "):" & vbCrLf & FriendlyError(resp), vbExclamation, "Smart Queue"
    End If
    Exit Function
EH:
    DoCmd.Hourglass False
    MsgBox "No connection to the queue system:" & vbCrLf & Err.Description, vbCritical, "Smart Queue"
End Function

Private Function FriendlyError(ByVal resp As String) As String
    Select Case JVal(resp, "error")
        Case "bad_token":             FriendlyError = "QUEUE_TOKEN in Access does not match QUEUE_API_TOKEN in Vercel."
        Case "booking_not_in_queue":  FriendlyError = "This patient is not in today's " & JVal(resp, "clinic") & " list." & vbCrLf & _
                                      "List comes from PC: " & JVal(resp, "source_pc") & SourceNote(resp)
        Case "empty":                 FriendlyError = "Nobody is waiting in " & JVal(resp, "clinic") & " on " & JVal(resp, "date") & "." & vbCrLf & vbCrLf & _
                                      "Today's list: " & JVal(resp, "by_status") & vbCrLf & _
                                      "List comes from PC: " & JVal(resp, "source_pc") & SourceNote(resp) & vbCrLf & vbCrLf & _
                                      "- All called / done: everyone was already called. Use 'call this patient' to re-call one." & vbCrLf & _
                                      "- Wrong PC: in reception pick this PC under 'List source', or check its QueuePush task."
        Case "too_soon":              FriendlyError = "Pressed twice too quickly - the first call is already playing."
        Case "no_target":             FriendlyError = "No patient is currently called."
        Case "invalid_state":         FriendlyError = "This patient cannot be called in his current state (already done / in room)."
        Case Else:                    FriendlyError = Left$(resp, 300)
    End Select
End Function

Private Function SourceNote(ByVal resp As String) As String
    Dim n As String: n = JVal(resp, "push_note")
    If n <> "" Then SourceNote = vbCrLf & "Problem: " & n
End Function

Private Function CurrentUserLabel() As String
    On Error Resume Next
    CurrentUserLabel = "Access@" & Environ$("COMPUTERNAME")
End Function

Private Function JEsc(ByVal s As String) As String
    JEsc = Replace(Replace(s, "\", "\\"), """", "\""")
End Function

' tiny JSON reader for "key":value or "key":"value"
Private Function JVal(ByVal s As String, ByVal key As String) As String
    Dim p As Long, q As Long
    p = InStr(s, """" & key & """:")
    If p = 0 Then Exit Function
    p = p + Len(key) + 3
    If Mid$(s, p, 1) = """" Then
        q = InStr(p + 1, s, """")
        If q > p Then JVal = Mid$(s, p + 1, q - p - 1)
    Else
        q = p
        Do While q <= Len(s)
            If InStr(",}", Mid$(s, q, 1)) > 0 Then Exit Do
            q = q + 1
        Loop
        JVal = Mid$(s, p, q - p)
        If JVal = "null" Then JVal = ""
    End If
End Function
