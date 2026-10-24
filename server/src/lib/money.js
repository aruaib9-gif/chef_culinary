const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 })

export const formatKobo = (kobo) => naira.format((Number(kobo) || 0) / 100).replace('NGN', '₦')
