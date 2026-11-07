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
'     =QueueRepeat()                      repeat the current call
'     =QueueInRoom()  /  =QueueDone()     patient entered / finished
'
'  QUEUE_CLINIC = "auto" -> Friday = Toukh, other days = Heliopolis
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
           ",""actor"":""" & JEsc(CurrentUserLabel()) & """}"

    Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    x.setTimeouts 5000, 5000, 15000, 15000
    x.Open "POST", QUEUE_URL, False
    x.setRequestHeader "Content-Type", "application/json; charset=utf-8"
    x.setRequestHeader "X-Queue-Token", QUEUE_TOKEN
    x.send body
    resp = x.responseText

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
    MsgBox "No connection to the queue system:" & vbCrLf & Err.Description, vbCritical, "Smart Queue"
End Function

Private Function FriendlyError(ByVal resp As String) As String
    Select Case JVal(resp, "error")
        Case "bad_token":             FriendlyError = "QUEUE_TOKEN in Access does not match QUEUE_API_TOKEN in Vercel."
        Case "booking_not_in_queue":  FriendlyError = "This patient is not in today's queue yet (QUEUE_TODAY) or belongs to another clinic."
        Case "empty":                 FriendlyError = "Nobody is waiting."
        Case "too_soon":              FriendlyError = "Pressed twice too quickly - the first call is already playing."
        Case "no_target":             FriendlyError = "No patient is currently called."
        Case "invalid_state":         FriendlyError = "This patient cannot be called in his current state (already done / in room)."
        Case Else:                    FriendlyError = Left$(resp, 300)
    End Select
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
