// Email Templates for Depileve Registration System - BEAUTIFUL & CLEAN

const LOGO_URL =
  "https://cdn.shopify.com/s/files/1/0951/3916/8572/files/DepiLogo_SmlBlck.png?v=1760480487";

// Beautiful email styles matching your design
const emailStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap');
  
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  body { 
    font-family: 'Poppins', -apple-system, sans-serif;
    line-height: 1.7; 
    color: #2c2c2c; 
    background: #f5f5f5;
  }
  
  .email-wrapper { 
    background: #f5f5f5; 
    padding: 40px 20px; 
  }
  
  .container { 
    max-width: 600px; 
    margin: 0 auto; 
    background: #ffffff;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }
  
  .logo { 
    text-align: center; 
    padding: 40px 20px 30px;
    background: #ffffff;
  }
  
  .logo img { 
    max-width: 140px; 
    height: auto; 
    display: block;
    margin: 0 auto;
  }
  
  .header { 
    background: linear-gradient(135deg, rgba(197, 184, 214, 0.3) 0%, rgba(168, 213, 211, 0.3) 100%);
    padding: 50px 40px; 
    text-align: center;
  }
  
  .header h1 { 
    font-family: 'Poppins', sans-serif;
    color: #2c2c2c; 
    font-size: 32px; 
    font-weight: 600;
    margin: 0;
  }
  
  .header .emoji {
    font-size: 48px;
    display: block;
    margin-bottom: 15px;
  }
  
  .content { 
    padding: 40px;
  }
  
  .content p {
    margin: 0 0 20px 0;
    font-size: 16px;
    color: #2c2c2c;
    line-height: 1.7;
  }
  
  .status-box { 
    background: rgba(250, 243, 224, 0.5);
    padding: 24px 28px; 
    margin: 30px 0;
    border-radius: 8px;
    border-left: 4px solid #c5b8d6;
  }
  
  .status-box p {
    margin: 0 0 14px 0;
    font-size: 15px;
    color: #2c2c2c;
  }
  
  .status-box p:last-child { margin: 0; }
  
  .status-icon {
    font-size: 18px;
    margin-right: 8px;
  }
  
  .status-label {
    font-weight: 600;
    color: #2c2c2c;
  }
  
  .please-note {
    background: #fff8f0;
    padding: 18px 24px;
    margin: 25px 0;
    border-radius: 8px;
    border-left: 4px solid #f4b462;
    font-size: 15px;
  }
  
  .please-note strong {
    color: #2c2c2c;
  }
  
  .button { 
    display: inline-block; 
    padding: 16px 40px; 
    background: #a8d5d3; 
    color: #000000; 
    text-decoration: none; 
    border-radius: 8px; 
    font-weight: 600; 
    font-size: 16px;
    transition: background 0.2s;
  }
  
  .button:hover {
    background: #92c4c2;
  }
  
  .button-wrapper {
    text-align: center;
    margin: 35px 0;
  }
  
  .info-card { 
    background: #fafafa; 
    padding: 24px; 
    border-radius: 8px; 
    margin: 30px 0;
    border: 1px solid #f0f0f0;
  }
  
  .info-row {
    padding: 12px 0;
    font-size: 15px;
    border-bottom: 1px solid #f0f0f0;
  }
  
  .info-row:last-child { border: none; }
  
  .info-label {
    font-weight: 600;
    color: #999;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: block;
    margin-bottom: 6px;
  }
  
  .info-value {
    color: #2c2c2c;
    font-size: 15px;
  }
  
  .info-value a {
    color: #ee9bbd;
    text-decoration: none;
  }
  
  .files-box {
    background: rgba(168, 213, 211, 0.1);
    padding: 24px;
    border-radius: 8px;
    margin: 30px 0;
    border: 1px dashed #a8d5d3;
  }
  
  .files-box strong {
    display: block;
    margin-bottom: 14px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #2c2c2c;
  }
  
  .files-box a {
    color: #ee9bbd;
    text-decoration: none;
    font-size: 15px;
    display: block;
    padding: 10px 0;
    border-bottom: 1px solid rgba(168, 213, 211, 0.2);
  }
  
  .files-box a:last-child {
    border: none;
  }
  
  .files-box a:hover {
    color: #f4c2d7;
  }
  
  .footer { 
    background: #fafafa; 
    padding: 30px; 
    text-align: center; 
    font-size: 13px; 
    color: #999;
    border-top: 1px solid #f0f0f0;
  }
  
  .footer p {
    margin: 0;
  }
  
  .team-signature {
    margin-top: 35px;
    padding-top: 25px;
    border-top: 1px solid #f0f0f0;
  }
  
  .team-signature p {
    margin: 0 0 5px 0;
    font-size: 15px;
    color: #666;
  }
  
  .team-signature strong {
    color: #2c2c2c;
    font-weight: 600;
  }
  
  @media (max-width: 600px) {
    .email-wrapper { padding: 20px 10px; }
    .logo { padding: 30px 20px 20px; }
    .header { padding: 35px 24px; }
    .header h1 { font-size: 26px; }
    .content { padding: 30px 24px; }
  }
`;

// Email 1: Customer Registration Pending
function getPendingApprovalEmail(firstName, accountType) {
  const accountTypeText =
    accountType === "consumer"
      ? "a customer"
      : accountType === "student"
      ? "a student"
      : accountType === "esthetician"
      ? "an esthetician"
      : "a salon owner";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>${emailStyles}</style>
    </head>
    <body>
      <div class="email-wrapper">
        <div class="container">
          <div class="logo">
            <img src="${LOGO_URL}" alt="Depileve USA">
          </div>
          
          <div class="header">
            <span class="emoji">🎉</span>
            <h1>Registration Received!</h1>
          </div>
          
          <div class="content">
            <p>Hi <strong>${firstName}</strong>,</p>
            
            <p>Thank you for registering as <strong>${accountTypeText}</strong> with <strong>Depileve USA</strong>!</p>
            
            <div class="status-box">
              <p><span class="status-icon">📋</span><span class="status-label">Status:</span> Pending Approval</p>
              <p><span class="status-icon">⏰</span><span class="status-label">Review Time:</span> 1-2 business days</p>
            </div>
            
            <p>We're currently reviewing your registration. You'll receive another email once your account has been approved.</p>
            
            ${
              accountType !== "consumer"
                ? '<div class="please-note"><strong>Please note:</strong> Do not attempt to log in until you receive your approval email.</div>'
                : ""
            }
            
            <p>If you have any questions, feel free to reply to this email.</p>
            
            <div class="team-signature">
              <p>Best regards,</p>
              <p><strong>Depileve USA Team</strong></p>
            </div>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} Depileve USA. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Email 2: Store Owner Notification
function getOwnerNotificationEmail(customer, fileUrls, shopName) {
  const filesHtml =
    Object.keys(fileUrls).length > 0
      ? `
    <div class="files-box">
      <strong>📎 Uploaded Files</strong>
      ${
        fileUrls.licenseFile
          ? `<a href="${fileUrls.licenseFile}">→ View License File</a>`
          : ""
      }
      ${
        fileUrls.taxCertificate
          ? `<a href="${fileUrls.taxCertificate}">→ View Tax Certificate</a>`
          : ""
      }
      ${
        fileUrls.studentProof
          ? `<a href="${fileUrls.studentProof}">→ View Student Proof</a>`
          : ""
      }
    </div>
  `
      : "";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        ${emailStyles}
        .header-urgent {
          background: linear-gradient(135deg, rgba(244, 180, 98, 0.3) 0%, rgba(239, 199, 125, 0.3) 100%);
        }
      </style>
    </head>
    <body>
      <div class="email-wrapper">
        <div class="container">
          <div class="logo">
            <img src="${LOGO_URL}" alt="Depileve USA">
          </div>
          
          <div class="header header-urgent">
            <h1>New ${
              customer.accountType.charAt(0).toUpperCase() +
              customer.accountType.slice(1)
            } Registration</h1>
          </div>
          
          <div class="content">
            <p style="font-size: 18px; font-weight: 600; margin-bottom: 25px;">Action Required</p>
            
            <div class="info-card">
              <div class="info-row">
                <span class="info-label">Customer</span>
                <span class="info-value">${customer.firstName} ${
    customer.lastName
  }</span>
              </div>
              <div class="info-row">
                <span class="info-label">Email</span>
                <span class="info-value"><a href="mailto:${customer.email}">${
    customer.email
  }</a></span>
              </div>
              <div class="info-row">
                <span class="info-label">Phone</span>
                <span class="info-value">${customer.phone}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Account Type</span>
                <span class="info-value" style="text-transform: capitalize;">${
                  customer.accountType
                }</span>
              </div>
            </div>
            
            ${filesHtml}
            
            <div class="button-wrapper">
              <a href="https://${shopName}/admin/customers/${
    customer.customerId
  }" class="button">
                Review in Shopify Admin
              </a>
            </div>
            
            <div class="status-box">
              <p><strong>Next Steps:</strong></p>
              <p>1️⃣ Review customer information and uploaded files</p>
              <p>2️⃣ Verify license/student proof documents</p>
              <p>3️⃣ Approve or reject the registration in Shopify</p>
              <p>4️⃣ Customer will be notified automatically</p>
            </div>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} Depileve USA. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Email 3: Approval Confirmation
function getApprovalEmail(firstName, accountType, shopName) {
  const benefits =
    accountType !== "consumer"
      ? `
    <div class="status-box">
      <p><strong>🎁 Your Exclusive Benefits:</strong></p>
      <p>💰 Access to professional pricing</p>
      <p>🛍️ Exclusive member discounts</p>
      <p>🎁 Free samples with qualifying orders</p>
      <p>📦 Bulk ordering options available</p>
    </div>
  `
      : "";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>${emailStyles}</style>
    </head>
    <body>
      <div class="email-wrapper">
        <div class="container">
          <div class="logo">
            <img src="${LOGO_URL}" alt="Depileve USA">
          </div>
          
          <div class="header">
            <span class="emoji">🎉</span>
            <h1>You're Approved!</h1>
          </div>
          
          <div class="content">
            <p>Hi <strong>${firstName}</strong>,</p>
            
            <div class="status-box">
              <p style="font-size: 18px; font-weight: 600; color: #a8d5d3; margin: 0;">
                ✓ Your Account is Now Active!
              </p>
            </div>
            
            <p>You can now log in and start shopping with your special <strong>${accountType}</strong> benefits.</p>
            
            ${benefits}
            
            <div class="button-wrapper">
              <a href="https://${shopName}/account/login" class="button">
                Log In to Your Account
              </a>
            </div>
            
            <p style="text-align: center; font-size: 14px; color: #999;">
              Use the email and password you created during registration.
            </p>
            
            <div class="team-signature">
              <p>Welcome to the Depileve USA family!</p>
              <p><strong>The Depileve USA Team</strong></p>
            </div>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} Depileve USA. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Email 4: Rejection Notification
function getRejectionEmail(firstName, reason, senderEmail) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        ${emailStyles}
        .header-reject {
          background: linear-gradient(135deg, rgba(217, 169, 154, 0.3) 0%, rgba(239, 199, 125, 0.3) 100%);
        }
      </style>
    </head>
    <body>
      <div class="email-wrapper">
        <div class="container">
          <div class="logo">
            <img src="${LOGO_URL}" alt="Depileve USA">
          </div>
          
          <div class="header header-reject">
            <h1>Registration Update</h1>
          </div>
          
          <div class="content">
            <p>Hi <strong>${firstName}</strong>,</p>
            
            <p>Thank you for your interest in joining Depileve USA.</p>
            
            <div class="please-note">
              <p style="margin: 0 0 ${
                reason ? "12px" : "0"
              } 0;"><strong>Unfortunately, we were unable to approve your registration at this time.</strong></p>
              ${
                reason
                  ? `<p style="margin: 0;"><strong>Reason:</strong> ${reason}</p>`
                  : ""
              }
            </div>
            
            <p>If you believe this was a mistake or would like to provide additional information, please contact us:</p>
            
            <div class="info-card">
              <div class="info-row">
                <span class="info-label">Email</span>
                <span class="info-value"><a href="mailto:${senderEmail}">${senderEmail}</a></span>
              </div>
              <div class="info-row">
                <span class="info-label">Phone</span>
                <span class="info-value">(305) 594-3535</span>
              </div>
            </div>
            
            <p>We're happy to review your application again with updated information.</p>
            
            <div class="team-signature">
              <p>Best regards,</p>
              <p><strong>The Depileve USA Team</strong></p>
            </div>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} Depileve USA. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = {
  getPendingApprovalEmail,
  getOwnerNotificationEmail,
  getApprovalEmail,
  getRejectionEmail,
};
